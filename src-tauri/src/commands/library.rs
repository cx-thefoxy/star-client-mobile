//! Versions, loaders, instances, mods.
use super::St;
use crate::error::{AppError, AppResult};
use crate::instances::{Instance, InstanceDraft, LoaderKind};
use crate::minecraft::{install, manifest};
use serde::Serialize;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionRow {
    id: String,
    kind: String,
    category: manifest::Category,
    release_time: String,
    url: String,
    status: install::InstallStatus,
    java_major: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionList { latest_release: String, latest_snapshot: String, stale: bool, versions: Vec<VersionRow> }

#[tauri::command]
pub async fn list_versions(st: St<'_>, force: bool) -> AppResult<VersionList> {
    let dl = st.downloader().await;
    let (m, stale) = manifest::load(&dl, &st.paths.cache, force).await?;
    let dirs = st.dirs().await;
    let versions = m.versions.iter().map(|v| VersionRow {
        category: manifest::categorize(v),
        status: install::status(&dirs, &v.id),
        java_major: install::cached_java_major(&dirs, &v.id),
        id: v.id.clone(), kind: v.kind.clone(), release_time: v.release_time.clone(), url: v.url.clone(),
    }).collect();
    Ok(VersionList { latest_release: m.latest.release, latest_snapshot: m.latest.snapshot, stale, versions })
}

#[tauri::command]
pub async fn loader_compat(st: St<'_>, loader: LoaderKind, game_version: String) -> AppResult<crate::loaders::LoaderCompat> {
    crate::loaders::compat(&st.downloader().await, loader, &game_version).await
}

#[tauri::command]
pub async fn star_compat() -> AppResult<Vec<crate::star::StarCompat>> { Ok(crate::star::COMPAT.to_vec()) }

#[tauri::command]
pub async fn star_bundled(st: St<'_>) -> AppResult<Vec<String>> {
    Ok(crate::star::COMPAT.iter().filter(|c| crate::star::bundled_jar(st.resource_dir.as_deref(), c).is_some()).map(|c| c.minecraft.to_string()).collect())
}

#[tauri::command]
pub async fn list_instances(st: St<'_>) -> AppResult<Vec<Instance>> { Ok(st.instances.lock().await.list().to_vec()) }

#[tauri::command]
pub async fn create_instance(st: St<'_>, draft: InstanceDraft) -> AppResult<Instance> {
    let i = st.instances.lock().await.create(draft)?;
    tracing::info!("created instance {} ({})", i.id, i.version_id);
    Ok(i)
}

#[tauri::command]
pub async fn update_instance(st: St<'_>, id: String, draft: InstanceDraft) -> AppResult<Instance> {
    if st.games.is_running(&id).await { return Err(AppError::AlreadyRunning("close the game before editing this instance".into())); }
    st.instances.lock().await.update(&id, draft)
}

#[tauri::command]
pub async fn delete_instance(st: St<'_>, id: String, confirm_name: String, delete_files: bool) -> AppResult<Option<String>> {
    if st.games.is_running(&id).await { return Err(AppError::AlreadyRunning("close the game first".into())); }
    let moved = st.instances.lock().await.delete(&id, &confirm_name, delete_files, &st.paths.trash)?;
    Ok(moved.map(|p| p.display().to_string()))
}

#[tauri::command]
pub async fn set_instance_favorite(st: St<'_>, id: String, favorite: bool) -> AppResult<Instance> {
    st.instances.lock().await.set_favorite(&id, favorite)
}

#[tauri::command]
pub async fn duplicate_instance(st: St<'_>, id: String, copy_suffix: Option<String>) -> AppResult<Instance> {
    if st.games.is_running(&id).await { return Err(AppError::AlreadyRunning("close the game before duplicating".into())); }
    st.instances.lock().await.duplicate(&id, copy_suffix.as_deref().unwrap_or("(copy)"))
}

#[tauri::command]
pub async fn export_instance(st: St<'_>, id: String) -> AppResult<String> {
    if st.games.is_running(&id).await { return Err(AppError::AlreadyRunning("close the game before exporting".into())); }
    let out = st.instances.lock().await.export(&id, &st.paths.root.join("exports"))?;
    Ok(out.display().to_string())
}

/// The picked `.zip` arrives as the raw request body (header `x-file-name`); Android file pickers return content URIs, not paths.
#[tauri::command]
pub async fn import_instance(st: St<'_>, request: tauri::ipc::Request<'_>) -> AppResult<Instance> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err(AppError::Validation("no file received".into())) };
    let name = request.headers().get("x-file-name").and_then(|v| v.to_str().ok()).unwrap_or("import.zip");
    if !name.to_ascii_lowercase().ends_with(".zip") { return Err(AppError::Validation("a Star Client .zip export is required".into())); }
    let tmp = st.paths.cache.join("tmp");
    std::fs::create_dir_all(&tmp)?;
    let p = tmp.join(format!("import-{}.zip", uuid::Uuid::new_v4()));
    std::fs::write(&p, bytes)?;
    let r = st.instances.lock().await.import(&p);
    let _ = std::fs::remove_file(&p);
    r
}

async fn mods_dir(st: &St<'_>, id: &str) -> AppResult<(std::path::PathBuf, Instance)> {
    let s = st.instances.lock().await;
    let inst = s.get(id)?.clone();
    Ok((s.game_dir(id)?.join("mods"), inst))
}

fn loader_name(k: LoaderKind) -> &'static str {
    match k { LoaderKind::Vanilla => "vanilla", LoaderKind::Fabric => "fabric", LoaderKind::Quilt => "quilt", LoaderKind::Forge => "forge", LoaderKind::NeoForge => "neoforge" }
}

#[tauri::command]
pub async fn list_mods(st: St<'_>, instance_id: String) -> AppResult<Vec<crate::mods::ModInfo>> {
    let (dir, inst) = mods_dir(&st, &instance_id).await?;
    crate::mods::list(&dir, loader_name(inst.loader))
}

#[tauri::command]
pub async fn set_mod_enabled(st: St<'_>, instance_id: String, file_name: String, enabled: bool) -> AppResult<String> {
    if st.games.is_running(&instance_id).await { return Err(AppError::AlreadyRunning("close the game first".into())); }
    let (dir, _) = mods_dir(&st, &instance_id).await?;
    crate::mods::set_enabled(&dir, &file_name, enabled)
}

#[tauri::command]
pub async fn remove_mod(st: St<'_>, instance_id: String, file_name: String) -> AppResult<()> {
    if st.games.is_running(&instance_id).await { return Err(AppError::AlreadyRunning("close the game first".into())); }
    let (dir, _) = mods_dir(&st, &instance_id).await?;
    crate::mods::remove(&dir, &file_name)
}

#[tauri::command]
pub async fn search_modrinth(st: St<'_>, query: String, instance_id: String) -> AppResult<Vec<crate::modrinth::SearchProject>> {
    let inst = st.instances.lock().await.get(&instance_id)?.clone();
    crate::modrinth::search(&st.http, &query, &inst.version_id, loader_name(inst.loader), 40).await
}

#[tauri::command]
pub async fn install_modrinth(st: St<'_>, instance_id: String, project_id: String) -> AppResult<crate::modrinth::InstallResult> {
    if st.games.is_running(&instance_id).await { return Err(AppError::AlreadyRunning("close the game first".into())); }
    let inst = st.instances.lock().await.get(&instance_id)?.clone();
    let mods_dir = {
        let store = st.instances.lock().await;
        store.game_dir(&instance_id)?.join("mods")
    };
    let cancel = Arc::new(AtomicBool::new(false));
    crate::modrinth::install(
        &st.http, &st.downloader().await, mods_dir, &project_id, &inst.version_id,
        loader_name(inst.loader), cancel, Arc::new(|_| {}),
    ).await
}

#[tauri::command]
pub async fn get_hud_config(st: St<'_>, instance_id: String) -> AppResult<crate::star::HudConfig> {
    let dir = st.instances.lock().await.game_dir(&instance_id)?;
    Ok(crate::star::read_config(&dir))
}

#[tauri::command]
pub async fn save_hud_config(st: St<'_>, instance_id: String, config: crate::star::HudConfig) -> AppResult<crate::star::HudConfig> {
    let dir = st.instances.lock().await.game_dir(&instance_id)?;
    crate::star::write_config(&dir, config)
}
