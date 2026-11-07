//! OAuth 2.0 authorization code + PKCE with a loopback redirect (RFC 8252).
use super::config::AuthConfig;
use super::pkce::{self, Pkce};
use crate::error::{AppError, AppResult};
use serde::Deserialize;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

pub const AUTHORIZE: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
pub const TOKEN: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
pub const SCOPE: &str = "XboxLive.signin offline_access";

#[derive(Deserialize)]
pub struct MsTokens { pub access_token: String, pub refresh_token: Option<String>, pub expires_in: i64 }

#[derive(Deserialize)]
struct TokenError { error: String, #[serde(default)] error_description: Option<String> }

pub fn authorize_url(cfg: &AuthConfig, redirect: &str, p: &Pkce, state: &str) -> String {
    let mut u = url::Url::parse(AUTHORIZE).expect("static url");
    u.query_pairs_mut()
        .append_pair("client_id", &cfg.client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", redirect)
        .append_pair("response_mode", "query")
        .append_pair("scope", SCOPE)
        .append_pair("state", state)
        .append_pair("code_challenge", &p.challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("prompt", "select_account");
    u.into()
}

#[derive(Debug, PartialEq)]
pub enum Callback { Code(String), Denied(String), Ignore }

/// Parse the first line of the loopback HTTP request and validate `state`.
pub fn parse_callback(request_line: &str, expected_state: &str) -> AppResult<Callback> {
    let path = request_line.split_whitespace().nth(1).unwrap_or("/");
    let u = url::Url::parse(&format!("http://localhost{path}")).map_err(|_| AppError::Auth("malformed redirect".into()))?;
    let q: std::collections::HashMap<_, _> = u.query_pairs().into_owned().collect();
    if q.is_empty() { return Ok(Callback::Ignore); }
    let state_ok = q.get("state").map_or(false, |s| pkce::eq_ct(s, expected_state));
    if let Some(err) = q.get("error") {
        return Ok(Callback::Denied(q.get("error_description").cloned().unwrap_or_else(|| err.clone())));
    }
    if !state_ok { return Err(AppError::Auth("sign-in response failed state verification".into())); }
    match q.get("code") {
        Some(c) if !c.is_empty() => Ok(Callback::Code(c.clone())),
        _ => Ok(Callback::Ignore),
    }
}

const PAGE: &str = "<!doctype html><meta charset=utf-8><title>Star Client</title><body style=\"background:#0b0b0d;color:#eee;font-family:sans-serif;display:grid;place-items:center;height:100vh\"><div style=\"text-align:center\"><h2 style=\"color:#ff7a1a\">Star Client</h2><p>{MSG}</p><p style=\"opacity:.6\">You can close this tab.</p></div>";

async fn respond(mut s: TcpStream, msg: &str) {
    let body = PAGE.replace("{MSG}", msg);
    let resp = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
    let _ = s.write_all(resp.as_bytes()).await;
}

async fn read_request_line(s: &mut TcpStream) -> Option<String> {
    let mut buf = vec![0u8; 8192];
    let mut n = 0;
    while n < buf.len() {
        let r = tokio::time::timeout(Duration::from_secs(5), s.read(&mut buf[n..])).await.ok()?.ok()?;
        if r == 0 { break; }
        n += r;
        if buf[..n].windows(2).any(|w| w == b"\r\n") { break; }
    }
    String::from_utf8_lossy(&buf[..n]).lines().next().map(String::from)
}

/// Opens the system browser and waits (max 5 min) for the redirect. Returns MS tokens.
pub async fn interactive(http: &reqwest::Client, cfg: &AuthConfig, open: impl Fn(&str) -> AppResult<()>) -> AppResult<MsTokens> {
    let v4 = TcpListener::bind("127.0.0.1:0").await?;
    let port = v4.local_addr()?.port();
    let v6 = TcpListener::bind(("::1", port)).await.ok();
    let redirect = format!("http://localhost:{port}");
    let p = Pkce::new();
    let state = pkce::state();
    open(&authorize_url(cfg, &redirect, &p, &state))?;

    let code = tokio::time::timeout(Duration::from_secs(300), async {
        loop {
            let (mut sock, _) = match &v6 {
                Some(l6) => tokio::select! { r = v4.accept() => r?, r = l6.accept() => r? },
                None => v4.accept().await?,
            };
            let Some(line) = read_request_line(&mut sock).await else { continue };
            match parse_callback(&line, &state) {
                Ok(Callback::Code(c)) => { respond(sock, "Signed in. Return to Star Client.").await; return Ok::<_, AppError>(c); }
                Ok(Callback::Denied(d)) => { respond(sock, "Sign-in was cancelled.").await; return Err(AppError::Auth(format!("Microsoft sign-in cancelled: {d}"))); }
                Ok(Callback::Ignore) => { respond(sock, "Waiting for Microsoft…").await; }
                Err(e) => { respond(sock, "Sign-in could not be verified.").await; return Err(e); }
            }
        }
    }).await.map_err(|_| AppError::Auth("sign-in timed out after 5 minutes".into()))??;

    token_request(http, &[
        ("client_id", cfg.client_id.as_str()), ("grant_type", "authorization_code"), ("code", code.as_str()),
        ("redirect_uri", redirect.as_str()), ("code_verifier", p.verifier.as_str()), ("scope", SCOPE),
    ]).await
}

pub async fn refresh(http: &reqwest::Client, cfg: &AuthConfig, refresh_token: &str) -> AppResult<MsTokens> {
    token_request(http, &[
        ("client_id", cfg.client_id.as_str()), ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token), ("scope", SCOPE),
    ]).await
}

async fn token_request(http: &reqwest::Client, form: &[(&str, &str)]) -> AppResult<MsTokens> {
    let r = http.post(TOKEN).form(form).send().await?;
    if r.status().is_success() { return Ok(r.json().await?); }
    let status = r.status();
    let e: TokenError = r.json().await.unwrap_or(TokenError { error: format!("http_{status}"), error_description: None });
    Err(map_token_error(&e.error, e.error_description.as_deref()))
}

pub fn map_token_error(error: &str, desc: Option<&str>) -> AppError {
    match error {
        "invalid_grant" | "interaction_required" => AppError::AuthExpired,
        "invalid_client" | "unauthorized_client" => AppError::Auth("The configured Azure app is not allowed for personal Microsoft accounts. Check docs/AUTH_SETUP.md.".into()),
        _ => AppError::Auth(super::redact::redact(&format!("{error}: {}", desc.unwrap_or("")))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_authorize_url() {
        let p = Pkce::new();
        let u = authorize_url(&AuthConfig { client_id: "00000000-0000-0000-0000-000000000000".into() }, "http://localhost:5000", &p, "st");
        assert!(u.starts_with(AUTHORIZE));
        assert!(u.contains("code_challenge_method=S256"));
        assert!(u.contains("scope=XboxLive.signin+offline_access"));
        assert!(!u.contains(&p.verifier), "verifier must never leave the app");
    }

    #[test]
    fn callback_parsing() {
        assert_eq!(parse_callback("GET /?code=abc&state=xyz HTTP/1.1", "xyz").unwrap(), Callback::Code("abc".into()));
        assert!(parse_callback("GET /?code=abc&state=bad HTTP/1.1", "xyz").is_err());
        assert!(parse_callback("GET /?code=abc HTTP/1.1", "xyz").is_err());
        assert_eq!(parse_callback("GET /favicon.ico HTTP/1.1", "xyz").unwrap(), Callback::Ignore);
        assert!(matches!(parse_callback("GET /?error=access_denied&state=xyz HTTP/1.1", "xyz").unwrap(), Callback::Denied(_)));
    }

    #[test]
    fn token_errors_never_leak_secrets() {
        assert!(matches!(map_token_error("invalid_grant", None), AppError::AuthExpired));
        let e = map_token_error("weird", Some("refresh_token=M.C507_BAY.0.U.-abcdefghijklmnopqrstuvwxyz123"));
        assert!(!e.to_string().contains("abcdefghijklmnop"));
    }
}
