//! Xbox Live + Minecraft services token exchanges.
use super::redact::redact;
use crate::error::{AppError, AppResult};
use serde::Deserialize;
use serde_json::json;

pub const XBL_AUTH: &str = "https://user.auth.xboxlive.com/user/authenticate";
pub const XSTS_AUTH: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
pub const MC_LOGIN: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
pub const MC_ENTITLEMENTS: &str = "https://api.minecraftservices.com/entitlements/mcstore";
pub const MC_PROFILE: &str = "https://api.minecraftservices.com/minecraft/profile";

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct XblResponse { token: String, display_claims: DisplayClaims }
#[derive(Deserialize)]
struct DisplayClaims { xui: Vec<Xui> }
#[derive(Deserialize)]
struct Xui { uhs: String, #[serde(default)] xid: Option<String> }

#[derive(Deserialize)]
struct McLogin { access_token: String, expires_in: i64 }

#[derive(Debug, Clone, Deserialize)]
pub struct McProfile {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub skins: Vec<Skin>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct Skin { pub url: String, pub state: String, #[serde(default)] pub variant: Option<String> }

#[derive(Deserialize)]
struct Entitlements { #[serde(default)] items: Vec<Item> }
#[derive(Deserialize)]
struct Item { name: String }

pub struct McSession { pub access_token: String, pub expires_at: i64, pub profile: McProfile, pub xuid: String }

/// User-facing explanation for documented XSTS `XErr` codes.
pub fn xerr_message(code: u64) -> String {
    match code {
        2148916227 => "This Xbox account is banned.".into(),
        2148916229 => "Xbox Live access is restricted by parental controls on this account.".into(),
        2148916233 => "This Microsoft account has no Xbox profile yet. Sign in once at xbox.com to create one, then retry.".into(),
        2148916235 => "Xbox Live is not available in this account's country/region.".into(),
        2148916236 | 2148916237 => "This account requires adult verification on xbox.com (South Korea).".into(),
        2148916238 => "This is a child account. An adult must add it to a Microsoft family group first.".into(),
        c => format!("Xbox Live rejected the sign-in (XErr {c})."),
    }
}

async fn post_json(http: &reqwest::Client, url: &str, body: serde_json::Value) -> AppResult<reqwest::Response> {
    Ok(http.post(url).header("Accept", "application/json").json(&body).send().await?)
}

pub async fn minecraft_session(http: &reqwest::Client, ms_access_token: &str) -> AppResult<McSession> {
    // 1. Xbox Live user token
    let r = post_json(http, XBL_AUTH, json!({
        "Properties": { "AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": format!("d={ms_access_token}") },
        "RelyingParty": "http://auth.xboxlive.com", "TokenType": "JWT"
    })).await?;
    if !r.status().is_success() { return Err(AppError::Auth(format!("Xbox Live authentication failed (HTTP {})", r.status()))); }
    let xbl: XblResponse = r.json().await?;

    // 2. XSTS for Minecraft services
    let r = post_json(http, XSTS_AUTH, json!({
        "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbl.token] },
        "RelyingParty": "rp://api.minecraftservices.com/", "TokenType": "JWT"
    })).await?;
    if r.status() == reqwest::StatusCode::UNAUTHORIZED {
        let v: serde_json::Value = r.json().await.unwrap_or_default();
        return Err(AppError::Auth(xerr_message(v["XErr"].as_u64().unwrap_or(0))));
    }
    if !r.status().is_success() { return Err(AppError::Auth(format!("XSTS authorization failed (HTTP {})", r.status()))); }
    let xsts: XblResponse = r.json().await?;
    let claim = xsts.display_claims.xui.first().ok_or_else(|| AppError::Auth("XSTS response had no user hash".into()))?;

    // 3. Minecraft services
    let r = post_json(http, MC_LOGIN, json!({ "identityToken": format!("XBL3.0 x={};{}", claim.uhs, xsts.token) })).await?;
    match r.status().as_u16() {
        200 => {}
        403 => return Err(AppError::Auth("Minecraft services refused this app. New Azure app IDs must be approved by Mojang before they can sign in (see docs/AUTH_SETUP.md).".into())),
        429 => return Err(AppError::NetworkTransient("Minecraft services rate limit, try again in a minute".into())),
        s => return Err(AppError::Auth(format!("Minecraft login failed (HTTP {s})"))),
    }
    let mc: McLogin = r.json().await?;

    // 4. Ownership
    let ent: Entitlements = http.get(MC_ENTITLEMENTS).bearer_auth(&mc.access_token).send().await?.json().await?;
    let owns = ent.items.iter().any(|i| i.name == "product_minecraft" || i.name == "game_minecraft");

    // 5. Java profile (404 = no Java Edition profile)
    let r = http.get(MC_PROFILE).bearer_auth(&mc.access_token).send().await?;
    if r.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::Auth(if owns {
            "You own Minecraft but haven't created a Java Edition profile name yet. Create one at minecraft.net, then retry.".into()
        } else {
            "This account does not own Minecraft: Java Edition.".into()
        }));
    }
    if !r.status().is_success() { return Err(AppError::Auth(format!("profile lookup failed (HTTP {})", r.status()))); }
    let profile: McProfile = r.json().await.map_err(|e| AppError::Auth(redact(&e.to_string())))?;
    // Game Pass accounts can have a profile while `items` is empty; the profile is the authoritative check.
    Ok(McSession {
        access_token: mc.access_token,
        expires_at: chrono::Utc::now().timestamp() + mc.expires_in - 60,
        profile,
        xuid: claim.xid.clone().unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xerr_messages() {
        assert!(xerr_message(2148916233).contains("Xbox profile"));
        assert!(xerr_message(2148916238).contains("child"));
        assert!(xerr_message(1).contains("XErr 1"));
    }
}
