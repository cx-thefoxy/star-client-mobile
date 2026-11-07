use super::St;
use crate::config::Settings;
use crate::error::{AppError, AppResult};
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: &'static str,
    os: &'static str,
    arch: &'static str,
    total_ram_mb: Option<u64>,
    data_dir: String,
    settings_warning: Option<String>,
}

#[tauri::command]
pub async fn app_info(st: St<'_>) -> AppResult<AppInfo> {
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION"), os: std::env::consts::OS, arch: std::env::consts::ARCH,
        total_ram_mb: st.total_ram_mb, data_dir: st.paths.root.display().to_string(),
        settings_warning: st.settings_warning.clone(),
    })
}

#[tauri::command]
pub async fn get_settings(st: St<'_>) -> AppResult<Settings> { Ok(st.settings.lock().await.clone()) }

#[tauri::command]
pub async fn save_settings(st: St<'_>, settings: Settings) -> AppResult<Settings> {
    let s = settings.validated(st.total_ram_mb);
    crate::minecraft::arguments::validate_extra_jvm_args(&s.java.jvm_args.split_whitespace().map(String::from).collect::<Vec<_>>())?;
    if let Some(d) = &s.minecraft.game_dir {
        let p = std::path::Path::new(d);
        if !p.is_absolute() { return Err(AppError::Validation("game directory must be an absolute path".into())); }
        std::fs::create_dir_all(p)?;
    }
    st.settings_file.save(&s)?;
    let changed_dir = st.settings.lock().await.minecraft.game_dir != s.minecraft.game_dir;
    *st.settings.lock().await = s.clone();
    if changed_dir {
        let dirs = st.dirs().await;
        *st.instances.lock().await = crate::instances::InstanceStore::load(&st.paths.root, &dirs.instances);
    }
    Ok(s)
}

#[tauri::command]
pub async fn reset_settings(st: St<'_>) -> AppResult<Settings> {
    let s = Settings::default().validated(st.total_ram_mb);
    st.settings_file.save(&s)?;
    *st.settings.lock().await = s.clone();
    Ok(s)
}

/// The Java runtimes bundled in the app (8, 17, 21) and whether each is unpacked and usable.
#[tauri::command]
pub async fn detect_java(st: St<'_>) -> AppResult<Vec<crate::minecraft::java::JavaInstall>> {
    Ok(crate::minecraft::java::detect(&st.paths.runtimes).await)
}

#[tauri::command]
pub async fn diagnostics_report(st: St<'_>) -> AppResult<String> { Ok(crate::diagnostics::report(&st).await) }

/// Only https links are opened, in the system browser.
#[tauri::command]
pub async fn open_external(app: AppHandle, url: String) -> AppResult<()> {
    let u = url::Url::parse(&url).map_err(|_| AppError::Validation("invalid link".into()))?;
    if u.scheme() != "https" || u.host_str().is_none() { return Err(AppError::Validation("only https links can be opened".into())); }
    app.opener().open_url(u.as_str(), None::<&str>).map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))
}

#[derive(Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NewsItem { title: String, url: Option<String>, date: Option<String>, body: Option<String> }

/// Local, user-controlled news feed (`<data>/news.json`). No remote news service exists yet.
#[tauri::command]
pub async fn get_news(st: St<'_>) -> AppResult<Vec<NewsItem>> {
    let p = st.paths.root.join("news.json");
    let Ok(raw) = std::fs::read(&p) else { return Ok(vec![]) };
    let items: Vec<NewsItem> = serde_json::from_slice(&raw)?;
    Ok(items.into_iter().take(50).filter(|i| i.url.as_deref().map_or(true, |u| u.starts_with("https://"))).collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheInfo { bytes: u64, path: String }

#[tauri::command]
pub async fn cache_info(st: St<'_>) -> AppResult<CacheInfo> {
    fn size(p: &std::path::Path) -> u64 {
        std::fs::read_dir(p).map(|rd| rd.flatten().map(|e| {
            let m = e.metadata(); if m.as_ref().map_or(false, |m| m.is_dir()) { size(&e.path()) } else { m.map(|m| m.len()).unwrap_or(0) }
        }).sum()).unwrap_or(0)
    }
    Ok(CacheInfo { bytes: size(&st.paths.cache), path: st.paths.cache.display().to_string() })
}

/// Clears only the metadata cache. Never touches versions, instances, worlds or runtimes.
#[tauri::command]
pub async fn clear_cache(st: St<'_>, confirm: bool) -> AppResult<()> {
    if !confirm { return Err(AppError::Validation("confirmation required".into())); }
    if st.paths.cache.exists() { std::fs::remove_dir_all(&st.paths.cache)?; }
    std::fs::create_dir_all(&st.paths.cache)?;
    Ok(())
}
