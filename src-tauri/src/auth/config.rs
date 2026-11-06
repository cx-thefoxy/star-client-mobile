//! Azure / Entra application configuration. No client secret: Star Client is a public client.
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthConfig { pub client_id: String }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus { pub configured: bool, pub source: Option<String>, pub problem: Option<String> }

fn is_guid(s: &str) -> bool { uuid::Uuid::parse_str(s).is_ok() && s.len() == 36 }

/// Priority: env `STAR_MS_CLIENT_ID` → `<data>/auth-config.json` → compile-time `STAR_MS_CLIENT_ID`.
/// The client ID is never hardcoded: it always comes from one of those three places, and the winning
/// source is reported in `AuthStatus.source` (and logged at sign-in) so a stale value is easy to find.
pub fn load(root: &Path) -> (Option<AuthConfig>, AuthStatus) {
    let mut cands: Vec<(String, String)> = Vec::new();
    if let Ok(v) = std::env::var("STAR_MS_CLIENT_ID") { cands.push((v, "environment".into())); }
    if let Ok(raw) = std::fs::read_to_string(root.join("auth-config.json")) {
        match serde_json::from_str::<AuthConfig>(&raw) {
            Ok(c) => cands.push((c.client_id, "auth-config.json".into())),
            Err(e) => return (None, AuthStatus { configured: false, source: Some("auth-config.json".into()), problem: Some(format!("unreadable: {e}")) }),
        }
    }
    if let Some(v) = option_env!("STAR_MS_CLIENT_ID").filter(|v| !v.trim().is_empty()) { cands.push((v.to_string(), "build".into())); }
    resolve(cands, is_guid)
}

/// The placeholder from `auth-config.example.json` / `.env.example`; it is not a registered application.
const PLACEHOLDER_ID: &str = "00000000-0000-0000-0000-000000000000";

fn resolve(cands: Vec<(String, String)>, guid: impl Fn(&str) -> bool) -> (Option<AuthConfig>, AuthStatus) {
    let Some((id, src)) = cands.first().map(|(i, s)| (i.trim().to_string(), s.clone())) else {
        return (None, AuthStatus { configured: false, source: None, problem: None });
    };
    if !guid(&id) { return (None, AuthStatus { configured: false, source: Some(src), problem: Some("client ID is not a GUID".into()) }); }
    if id == PLACEHOLDER_ID {
        return (None, AuthStatus { configured: false, source: Some(src), problem: Some("client ID is still the all-zero placeholder; set your own Application (client) ID".into()) });
    }
    // A higher-priority source silently wins, so say when a lower one disagrees (typically a stale environment variable).
    let shadowed: Vec<&str> = cands.iter().skip(1).filter(|(i, _)| i.trim() != id).map(|(_, s)| s.as_str()).collect();
    let problem = (!shadowed.is_empty()).then(|| format!("using the client ID from {src}; it overrides a different one in {}", shadowed.join(", ")));
    (Some(AuthConfig { client_id: id.clone() }), AuthStatus { configured: true, source: Some(src), problem })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn g(s: &str) -> bool { s.len() == 36 }
    const A: &str = "11111111-1111-1111-1111-111111111111";
    const B: &str = "22222222-2222-2222-2222-222222222222";

    #[test]
    fn placeholder_is_not_configured() {
        let (c, st) = resolve(vec![(PLACEHOLDER_ID.into(), "auth-config.json".into())], g);
        assert!(c.is_none() && !st.configured && st.problem.unwrap().contains("placeholder"));
    }

    #[test]
    fn env_wins_and_conflict_is_reported() {
        let (c, st) = resolve(vec![(A.into(), "environment".into()), (B.into(), "auth-config.json".into())], g);
        assert_eq!(c.unwrap().client_id, A);
        assert_eq!(st.source.as_deref(), Some("environment"));
        assert!(st.problem.unwrap().contains("auth-config.json"));
        let (_, same) = resolve(vec![(A.into(), "environment".into()), (A.into(), "auth-config.json".into())], g);
        assert!(same.problem.is_none());
    }
}
