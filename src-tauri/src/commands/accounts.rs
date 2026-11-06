use super::St;
use crate::auth::{config, flow, store::{Account, AccountType, Session}, xbox};
use crate::error::{AppError, AppResult};
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountsView { accounts: Vec<Account>, active: Option<String>, auth: config::AuthStatus }

#[tauri::command]
pub async fn list_accounts(st: St<'_>) -> AppResult<AccountsView> {
    let (_, auth) = config::load(&st.paths.root);
    let a = st.accounts.lock().await;
    let (list, active) = a.list();
    Ok(AccountsView { accounts: list.to_vec(), active: active.map(String::from), auth })
}

#[tauri::command]
pub async fn sign_in(app: AppHandle, st: St<'_>) -> AppResult<Account> {
    let (cfg, status) = config::load(&st.paths.root);
    let cfg = cfg.ok_or(AppError::AuthNotConfigured).map_err(|e| {
        tracing::info!("sign-in blocked: {:?}", status.problem);
        e
    })?;
    tracing::info!("sign-in: client id {} from {} (scope \"{}\"){}", cfg.client_id, status.source.as_deref().unwrap_or("?"), flow::SCOPE,
        status.problem.as_deref().map(|p| format!("; warning: {p}")).unwrap_or_default());
    let tokens = flow::interactive(&st.http, &cfg, |url| {
        app.opener().open_url(url, None::<&str>).map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))
    }).await?;
    let session = xbox::minecraft_session(&st.http, &tokens.access_token).await?;
    let acc = Account {
        id: session.profile.id.clone(),
        name: session.profile.name.clone(),
        skin_url: session.profile.skins.iter().find(|s| s.state == "ACTIVE").map(|s| s.url.clone()),
        added_at: chrono::Utc::now().to_rfc3339(),
        needs_relogin: false,
        account_type: AccountType::Microsoft,
    };
    st.accounts.lock().await.upsert(acc.clone(), tokens.refresh_token.as_deref(), Session {
        access_token: session.access_token, expires_at: session.expires_at, xuid: session.xuid,
    })?;
    tracing::info!("signed in account {}", acc.id);
    Ok(acc)
}

#[tauri::command]
pub async fn add_offline_account(st: St<'_>, username: String) -> AppResult<Account> {
    let name = username.trim().to_string();
    let valid = (3..=16).contains(&name.chars().count())
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if !valid {
        return Err(AppError::Validation("offline username must be 3-16 characters and use only letters, numbers, or underscore".into()));
    }
    st.accounts.lock().await.add_offline(name)
}

#[derive(serde::Deserialize)]
struct MojangProfile { id: String }
#[derive(serde::Deserialize)]
struct SessionProp { name: String, value: String }
#[derive(serde::Deserialize)]
struct SessionProfile { properties: Vec<SessionProp> }
#[derive(serde::Deserialize)]
struct PlayerDbReply { success: bool, data: Option<PlayerDbData> }
#[derive(serde::Deserialize)]
struct PlayerDbData { player: Option<PlayerDbPlayer> }
#[derive(serde::Deserialize)]
struct PlayerDbPlayer { raw_id: Option<String>, skin_texture: Option<String> }

/// What a lookup against one service said: an answer, a definite "no such player/skin", or no usable answer
/// (network error, rate limit, server error), which is the only case that moves on to the next service.
enum Probe<T> { Found(T), Missing, Failed }

/// What the user typed in the skin field: a Minecraft username or a player UUID.
#[derive(Debug, PartialEq)]
enum SkinQuery { Name(String), Uuid(String) }

const SKIN_FETCH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(8);
const MAX_SKIN_BYTES: usize = 512 * 1024;

fn is_hex32(s: &str) -> bool { s.len() == 32 && s.bytes().all(|b| b.is_ascii_hexdigit()) }

/// Accepts a username (3-16 letters, digits, underscore) or a UUID (32 hex digits, with or without dashes).
/// A UUID is returned as 32 lowercase hex digits. Anything else is not a lookup.
fn parse_skin_query(input: &str) -> Option<SkinQuery> {
    let t = input.trim();
    if t.len() == 36 {
        let b = t.as_bytes();
        if [8, 13, 18, 23].iter().any(|&i| b[i] != b'-') { return None; }
        let compact: String = t.chars().filter(|c| *c != '-').collect();
        return is_hex32(&compact).then(|| SkinQuery::Uuid(compact.to_ascii_lowercase()));
    }
    if is_hex32(t) { return Some(SkinQuery::Uuid(t.to_ascii_lowercase())); }
    if (3..=16).contains(&t.chars().count()) && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Some(SkinQuery::Name(t.to_string()));
    }
    None
}

/// True for a PNG whose size is a valid skin: 64x32, 64x64, or the same at a whole multiple (HD skins).
fn is_skin_png(b: &[u8]) -> bool {
    if b.len() < 24 || b[..8] != [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A] || &b[12..16] != b"IHDR" { return false; }
    let w = u32::from_be_bytes([b[16], b[17], b[18], b[19]]);
    let h = u32::from_be_bytes([b[20], b[21], b[22], b[23]]);
    w >= 64 && w <= 1024 && w % 64 == 0 && (h == w || h * 2 == w)
}

/// Downloads a skin and returns it only if it really is a skin PNG of a sane size.
async fn fetch_skin_png(http: &reqwest::Client, url: &str) -> Option<Vec<u8>> {
    let r = http.get(url).timeout(SKIN_FETCH_TIMEOUT).send().await.ok()?;
    if !r.status().is_success() { return None; }
    if r.content_length().is_some_and(|n| n as usize > MAX_SKIN_BYTES) { return None; }
    let bytes = r.bytes().await.ok()?;
    (bytes.len() <= MAX_SKIN_BYTES && is_skin_png(&bytes)).then(|| bytes.to_vec())
}

/// Username -> UUID through Mojang.
async fn mojang_uuid(http: &reqwest::Client, name: &str) -> Probe<String> {
    let Ok(r) = http.get(format!("https://api.mojang.com/users/profiles/minecraft/{name}")).timeout(SKIN_FETCH_TIMEOUT).send().await else { return Probe::Failed };
    let status = r.status();
    if status == reqwest::StatusCode::NOT_FOUND || status == reqwest::StatusCode::NO_CONTENT { return Probe::Missing; }
    if !status.is_success() { return Probe::Failed; }
    match r.json::<MojangProfile>().await {
        Ok(p) if is_hex32(&p.id) => Probe::Found(p.id.to_ascii_lowercase()),
        _ => Probe::Failed,
    }
}

/// Skin from Mojang's session server (rate-limited per profile, so it can answer 429).
/// `Found(None)` means the player exists but has no custom skin.
async fn session_skin(http: &reqwest::Client, id: &str) -> Probe<Option<String>> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let Ok(r) = http.get(format!("https://sessionserver.mojang.com/session/minecraft/profile/{id}")).timeout(SKIN_FETCH_TIMEOUT).send().await else { return Probe::Failed };
    let status = r.status();
    if status == reqwest::StatusCode::NOT_FOUND || status == reqwest::StatusCode::NO_CONTENT { return Probe::Missing; }
    if !status.is_success() { return Probe::Failed; }
    let Ok(sp) = r.json::<SessionProfile>().await else { return Probe::Failed };
    let Some(tex) = sp.properties.iter().find(|p| p.name == "textures") else { return Probe::Found(None) };
    let Some(v) = STANDARD.decode(tex.value.as_bytes()).ok().and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok()) else { return Probe::Failed };
    Probe::Found(v["textures"]["SKIN"]["url"].as_str().map(|u| u.replacen("http://", "https://", 1)))
}

/// Second source for both steps: PlayerDB answers a name or a UUID with the player's UUID and skin link.
async fn playerdb(http: &reqwest::Client, query: &str) -> Probe<(String, Option<String>)> {
    let Ok(r) = http.get(format!("https://playerdb.co/api/player/minecraft/{query}")).timeout(SKIN_FETCH_TIMEOUT).send().await else { return Probe::Failed };
    let Ok(reply) = r.json::<PlayerDbReply>().await else { return Probe::Failed };
    if !reply.success { return Probe::Missing; }
    match reply.data.and_then(|d| d.player) {
        Some(PlayerDbPlayer { raw_id: Some(id), skin_texture }) if is_hex32(&id) => {
            Probe::Found((id.to_ascii_lowercase(), skin_texture.map(|u| u.replacen("http://", "https://", 1))))
        }
        _ => Probe::Failed,
    }
}

fn skin_data_url(png: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine};
    format!("data:image/png;base64,{}", STANDARD.encode(png))
}

/// Looks up the real skin for a Minecraft username or UUID, for the account preview only.
///
/// Order: Mojang (name -> UUID, then the session server's skin link), then PlayerDB, Crafatar and Minotar
/// whenever a step gets no usable answer. The picture itself is downloaded here, checked to be a real
/// skin PNG, and handed to the UI as a `data:` URL, so the UI needs no network access for it.
/// `Ok(None)` = no such player, or the player uses the default skin. `Err` = no service could be reached.
#[tauri::command]
pub async fn lookup_skin(st: St<'_>, username: String) -> AppResult<Option<String>> {
    let Some(query) = parse_skin_query(&username) else { return Ok(None) };
    let http = &st.http;

    // 1. The player's UUID (and, when the fallback answered, already its skin link).
    let mut pdb_skin: Option<String> = None;
    let id = match query {
        SkinQuery::Uuid(id) => id,
        SkinQuery::Name(name) => match mojang_uuid(http, &name).await {
            Probe::Found(id) => id,
            Probe::Missing => return Ok(None),
            Probe::Failed => match playerdb(http, &name).await {
                Probe::Found((id, skin)) => { pdb_skin = skin; id }
                Probe::Missing => return Ok(None),
                Probe::Failed => return Err(AppError::NetworkTransient("skin lookup: Mojang and PlayerDB are unreachable".into())),
            },
        },
    };

    // 2. The skin link from Mojang. A definite answer (no skin / unknown player) ends the lookup.
    match session_skin(http, &id).await {
        Probe::Found(Some(url)) => {
            if let Some(png) = fetch_skin_png(http, &url).await { return Ok(Some(skin_data_url(&png))); }
        }
        Probe::Found(None) | Probe::Missing => return Ok(None),
        Probe::Failed => {}
    }

    // 3. Fallbacks, only reached when Mojang gave no usable skin picture.
    if pdb_skin.is_none() {
        match playerdb(http, &id).await {
            Probe::Found((_, skin)) => pdb_skin = skin,
            Probe::Missing => return Ok(None),
            Probe::Failed => {}
        }
    }
    let mut candidates: Vec<String> = Vec::new();
    candidates.extend(pdb_skin);
    candidates.push(format!("https://crafatar.com/skins/{id}"));
    candidates.push(format!("https://minotar.net/skin/{id}"));
    for url in candidates {
        if let Some(png) = fetch_skin_png(http, &url).await { return Ok(Some(skin_data_url(&png))); }
    }
    Err(AppError::NetworkTransient("skin lookup: no skin service could be reached".into()))
}

#[cfg(test)]
mod skin_tests {
    use super::*;

    #[test]
    fn parses_names_and_uuids() {
        assert_eq!(parse_skin_query("  Technoblade "), Some(SkinQuery::Name("Technoblade".into())));
        assert_eq!(parse_skin_query("a_b"), Some(SkinQuery::Name("a_b".into())));
        assert_eq!(parse_skin_query("ab"), None);
        assert_eq!(parse_skin_query("bad name"), None);
        assert_eq!(parse_skin_query("this_name_is_way_too_long"), None);
        let id = "b876ec32e396476ba1158438d83c67d4".to_string();
        assert_eq!(parse_skin_query(&id), Some(SkinQuery::Uuid(id.clone())));
        assert_eq!(parse_skin_query("B876EC32-E396-476B-A115-8438D83C67D4"), Some(SkinQuery::Uuid(id)));
        assert_eq!(parse_skin_query("b876ec32-e396476b-a115-8438d83c67d4x"), None);
        assert_eq!(parse_skin_query("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"), None);
    }

    #[test]
    fn accepts_only_skin_pngs() {
        let mut png = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, b'I', b'H', b'D', b'R'];
        png.extend_from_slice(&64u32.to_be_bytes());
        png.extend_from_slice(&64u32.to_be_bytes());
        assert!(is_skin_png(&png));
        png[23] = 32;
        assert!(is_skin_png(&png));
        png[23] = 50;
        assert!(!is_skin_png(&png));
        assert!(!is_skin_png(b"<html>not a png at all, just some text</html>"));
    }
}

/// Returns a usable Minecraft session, refreshing via the stored refresh token when needed.
pub async fn ensure_session(st: &St<'_>, id: &str) -> AppResult<(String, String, String)> {
    {
        let a = st.accounts.lock().await;
        let acc = a.account(id)?;
        if acc.account_type == AccountType::Offline {
            return Ok((String::new(), acc.name.clone(), offline_uuid(&acc.name)));
        }
    }
    {
        let a = st.accounts.lock().await;
        if let Some(s) = a.valid_session(id) {
            let acc = a.account(id)?;
            return Ok((s.access_token.clone(), acc.name, acc.id));
        }
    }
    let (cfg, _) = config::load(&st.paths.root);
    let cfg = cfg.ok_or(AppError::AuthNotConfigured)?;
    let rt = st.accounts.lock().await.refresh_token(id)?.ok_or(AppError::AuthExpired)?;
    let refreshed = match flow::refresh(&st.http, &cfg, &rt).await {
        Ok(t) => t,
        Err(AppError::AuthExpired) => {
            st.accounts.lock().await.mark_relogin(id)?;
            return Err(AppError::AuthExpired);
        }
        Err(e) => return Err(e),
    };
    let session = xbox::minecraft_session(&st.http, &refreshed.access_token).await?;
    let mut a = st.accounts.lock().await;
    let acc = Account {
        id: session.profile.id.clone(), name: session.profile.name.clone(),
        skin_url: session.profile.skins.iter().find(|s| s.state == "ACTIVE").map(|s| s.url.clone()),
        added_at: a.account(id)?.added_at, needs_relogin: false, account_type: AccountType::Microsoft,
    };
    if acc.id != id { return Err(AppError::Auth("signed-in profile changed, please sign in again".into())); }
    let out = (session.access_token.clone(), acc.name.clone(), acc.id.clone());
    a.upsert(acc, refreshed.refresh_token.as_deref(), Session { access_token: session.access_token, expires_at: session.expires_at, xuid: session.xuid })?;
    Ok(out)
}

fn offline_uuid(name: &str) -> String {
    use md5::{Digest, Md5};
    let mut h = Md5::new();
    h.update(format!("OfflinePlayer:{name}").as_bytes());
    let mut b = [0u8; 16];
    b.copy_from_slice(&h.finalize());
    b[6] = (b[6] & 0x0f) | 0x30;
    b[8] = (b[8] & 0x3f) | 0x80;
    uuid::Uuid::from_bytes(b).hyphenated().to_string()
}

#[cfg(test)]
mod tests {
    use super::offline_uuid;

    #[test]
    fn offline_uuid_is_stable_and_rfc_variant() {
        assert_eq!(offline_uuid("Steve"), offline_uuid("Steve"));
        assert_ne!(offline_uuid("Steve"), offline_uuid("Alex"));
        assert_eq!(offline_uuid("Steve").len(), 36);
        assert_eq!(&offline_uuid("Steve")[14..15], "3");
    }
}

#[tauri::command]
pub async fn set_active_account(st: St<'_>, id: String) -> AppResult<()> { st.accounts.lock().await.set_active(&id) }

#[tauri::command]
pub async fn remove_account(st: St<'_>, id: String) -> AppResult<()> {
    st.accounts.lock().await.remove(&id)
}
