//! Resolve → download → verify → mark-complete installation pipeline.
use super::assets::{self, AssetIndex};
use super::manifest::VersionManifest;
use super::natives;
use super::rules::{rules_allow, Environment};
use super::version_json::{maven_path, merge, VersionJson};
use crate::downloads::{DownloadTask, Downloader, Progress};
use crate::error::{AppError, AppResult};
use crate::instances::LoaderKind;
use crate::paths::{safe_join, validate_id, GameDirs};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

pub const MARKER: &str = ".star-installed.json";

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InstallStatus { Installed, Incomplete, NotInstalled }

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Marker { schema: u32, id: String, completed_at: String, client_sha1: Option<String> }

pub fn status(dirs: &GameDirs, profile_id: &str) -> InstallStatus {
    let Ok(id) = validate_id(profile_id) else { return InstallStatus::NotInstalled };
    let dir = dirs.versions.join(id);
    if dir.join(MARKER).is_file() && dir.join(format!("{id}.json")).is_file() {
        InstallStatus::Installed
    } else if dir.exists() {
        InstallStatus::Incomplete
    } else {
        InstallStatus::NotInstalled
    }
}

/// Required Java major read from a locally cached version JSON, if present.
pub fn cached_java_major(dirs: &GameDirs, id: &str) -> Option<u32> {
    let id = validate_id(id).ok()?;
    let raw = std::fs::read(dirs.versions.join(id).join(format!("{id}.json"))).ok()?;
    let v: VersionJson = serde_json::from_slice(&raw).ok()?;
    Some(v.java_version.map(|j| j.major_version).unwrap_or(8))
}

#[derive(Debug, Clone)]
pub struct Resolved {
    pub version: VersionJson,
    pub base_id: String,
    pub profile_id: String,
    pub client_jar: PathBuf,
    pub classpath: Vec<PathBuf>,
    pub native_jars: Vec<(PathBuf, Vec<String>)>,
    pub asset_index_id: String,
    pub game_assets: PathBuf,
    pub logging_config: Option<PathBuf>,
}

pub struct InstallRequest<'a> {
    pub version_id: &'a str,
    pub loader: LoaderKind,
    pub loader_version: Option<&'a str>,
    /// Forge/NeoForge only: id of the profile the official installer already generated.
    pub loader_profile_id: Option<&'a str>,
    pub instance_game_dir: PathBuf,
}

pub type Sink = Arc<dyn Fn(&Progress) + Send + Sync>;

/// Downloads (or verifies) the vanilla version JSON and parses it.
pub async fn fetch_base(
    dl: &Downloader,
    dirs: &GameDirs,
    manifest: &VersionManifest,
    version_id: &str,
    cancel: Arc<AtomicBool>,
    sink: Sink,
) -> AppResult<VersionJson> {
    dirs.ensure()?;
    let base_id = validate_id(version_id)?;
    let entry = manifest.versions.iter().find(|v| v.id == base_id)
        .ok_or_else(|| AppError::NotFound(format!("Minecraft {base_id} is not in Mojang's manifest")))?;
    let base_json_path = dirs.versions.join(base_id).join(format!("{base_id}.json"));
    dl.run("metadata", vec![DownloadTask { url: entry.url.clone(), dest: base_json_path.clone(), sha1: entry.sha1.clone(), size: None }],
        cancel, sink).await?;
    serde_json::from_slice(&std::fs::read(&base_json_path)?)
        .map_err(|e| AppError::InvalidData(format!("{base_id}.json: {e}")))
}

pub async fn ensure_installed(
    dl: &Downloader,
    dirs: &GameDirs,
    manifest: &VersionManifest,
    env: &Environment,
    req: InstallRequest<'_>,
    cancel: Arc<AtomicBool>,
    sink: Sink,
) -> AppResult<Resolved> {
    dirs.ensure()?;
    let base_id = validate_id(req.version_id)?.to_string();
    let base_dir = dirs.versions.join(&base_id);

    // 1. Vanilla version JSON (sha1 from manifest).
    let base = fetch_base(dl, dirs, manifest, &base_id, cancel.clone(), sink.clone()).await?;

    // 2. Optional loader profile.
    let (version, profile_id) = match req.loader {
        LoaderKind::Vanilla => (base.clone(), base_id.clone()),
        LoaderKind::Fabric | LoaderKind::Quilt => {
            let lv = req.loader_version.ok_or_else(|| AppError::Validation("loader version required".into()))?;
            let (pid, profile) = crate::loaders::fetch_profile(dl, req.loader, &base_id, lv).await?;
            let pdir = dirs.versions.join(validate_id(&pid)?);
            std::fs::create_dir_all(&pdir)?;
            crate::config::write_atomic(&pdir.join(format!("{pid}.json")), &serde_json::to_vec_pretty(&profile)?)?;
            (merge(profile, base.clone()), pid)
        }
        LoaderKind::Forge | LoaderKind::NeoForge => {
            let pid = req.loader_profile_id
                .ok_or_else(|| AppError::Validation("the Forge/NeoForge installer has not been run for this instance".into()))?;
            let pid = validate_id(pid)?.to_string();
            let raw = std::fs::read(dirs.versions.join(&pid).join(format!("{pid}.json")))
                .map_err(|_| AppError::NotFound(format!("loader profile {pid} is missing; launch again to reinstall it")))?;
            let profile: VersionJson = serde_json::from_slice(&raw)
                .map_err(|e| AppError::InvalidData(format!("{pid}.json: {e}")))?;
            // Legacy (1.7.10–1.12.2) profiles are standalone, modern ones use `inheritsFrom`;
            // merging with the vanilla JSON is correct for both.
            (merge(profile, base.clone()), pid)
        }
    };

    // 3. Collect files.
    let client = base.downloads.as_ref().and_then(|d| d.client.clone())
        .ok_or_else(|| AppError::InvalidData(format!("{base_id} has no client download")))?;
    let client_jar = base_dir.join(format!("{base_id}.jar"));
    let mut tasks = vec![DownloadTask { url: client.url, dest: client_jar.clone(), sha1: client.sha1.clone(), size: client.size }];
    let mut classpath = Vec::new();
    let mut native_jars = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let forge_like = matches!(req.loader, LoaderKind::Forge | LoaderKind::NeoForge);

    for lib in &version.libraries {
        if !rules_allow(lib.rules.as_deref(), env) { continue; }
        let exclude = lib.extract.as_ref().map(|e| e.exclude.clone()).unwrap_or_default();
        // main artifact
        let art = match lib.downloads.as_ref().and_then(|d| d.artifact.clone()) {
            Some(a) => {
                let path = a.path.clone().or_else(|| maven_path(&lib.name))
                    .ok_or_else(|| AppError::InvalidData(format!("library {} has no path", lib.name)))?;
                Some((a.url, path, a.sha1, a.size))
            }
            None if lib.natives.is_none() => {
                let path = maven_path(&lib.name).ok_or_else(|| AppError::InvalidData(format!("bad coordinate {}", lib.name)))?;
                let base_url = lib.url.clone().unwrap_or_else(|| "https://libraries.minecraft.net/".into());
                let base_url = if base_url.ends_with('/') { base_url } else { format!("{base_url}/") };
                Some((format!("{base_url}{path}"), path, lib.sha1.clone(), lib.size))
            }
            None => None,
        };
        if let Some((url, path, sha1, size)) = art {
            let dest = safe_join(&dirs.libraries, &path)?;
            // Entries with no URL are produced locally by the Forge/NeoForge installer; for those
            // loaders anything the installer already placed on disk is used as-is.
            if url.is_empty() || (forge_like && dest.is_file()) {
                if dest.is_file() && seen.insert(dest.clone()) {
                    if natives::is_modern_native(lib) {
                        native_jars.push((dest.clone(), exclude.clone()));
                    }
                    classpath.push(dest);
                }
            } else if seen.insert(dest.clone()) {
                tasks.push(DownloadTask { url, dest: dest.clone(), sha1, size });
                if natives::is_modern_native(lib) {
                    native_jars.push((dest.clone(), exclude.clone()));
                }
                classpath.push(dest);
            }
        }
        // legacy natives
        if let Some(n) = natives::legacy_native_artifact(lib, env) {
            let path = n.path.clone().ok_or_else(|| AppError::InvalidData(format!("native of {} has no path", lib.name)))?;
            let dest = safe_join(&dirs.libraries, &path)?;
            if seen.insert(dest.clone()) {
                tasks.push(DownloadTask { url: n.url.clone(), dest: dest.clone(), sha1: n.sha1.clone(), size: n.size });
                native_jars.push((dest, exclude));
            }
        }
    }
    classpath.push(client_jar.clone());

    let logging_config = match version.logging.as_ref().and_then(|l| l.client.as_ref()) {
        Some(lc) => {
            let dest = safe_join(&dirs.assets.join("log_configs"), &lc.file.id)?;
            tasks.push(DownloadTask { url: lc.file.url.clone(), dest: dest.clone(), sha1: lc.file.sha1.clone(), size: lc.file.size });
            Some(dest)
        }
        None => None,
    };

    let ai = version.asset_index.clone()
        .ok_or_else(|| AppError::InvalidData(format!("{base_id} has no assetIndex")))?;
    let index_path = dirs.assets.join("indexes").join(format!("{}.json", validate_id(&ai.id)?));
    tasks.push(DownloadTask { url: ai.url.clone(), dest: index_path.clone(), sha1: ai.sha1.clone(), size: ai.size });

    check_disk_space(dirs, tasks.iter().filter_map(|t| t.size).sum::<u64>() + ai.total_size.unwrap_or(0))?;

    // 4. Download libraries + client + index.
    dl.run("libraries", tasks, cancel.clone(), sink.clone()).await?;

    // 5. Assets.
    let index: AssetIndex = serde_json::from_slice(&std::fs::read(&index_path)?)?;
    dl.run("assets", assets::tasks(&index, &dirs.assets)?, cancel.clone(), sink.clone()).await?;
    std::fs::create_dir_all(&req.instance_game_dir)?;
    let game_assets = assets::materialize_legacy(&index, &ai.id, &dirs.assets, &req.instance_game_dir)?;

    // 6. Completion marker written only after everything verified.
    let marker = Marker { schema: 1, id: profile_id.clone(), completed_at: chrono::Utc::now().to_rfc3339(), client_sha1: client.sha1 };
    let pdir = dirs.versions.join(&profile_id);
    std::fs::create_dir_all(&pdir)?;
    crate::config::write_atomic(&pdir.join(MARKER), &serde_json::to_vec(&marker)?)?;
    if profile_id != base_id {
        crate::config::write_atomic(&base_dir.join(MARKER), &serde_json::to_vec(&Marker { id: base_id.clone(), ..marker })?)?;
    }

    Ok(Resolved { version, base_id, profile_id, client_jar, classpath, native_jars, asset_index_id: ai.id, game_assets, logging_config })
}

fn check_disk_space(dirs: &GameDirs, needed: u64) -> AppResult<()> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let root = std::fs::canonicalize(&dirs.root).unwrap_or(dirs.root.clone());
    let best = disks.list().iter()
        .filter(|d| root.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len());
    if let Some(d) = best {
        // Files already on disk are included in `needed`, so only hard-fail when clearly impossible.
        let free = d.available_space();
        if free < 200 * 1024 * 1024 || (free < needed / 2) {
            return Err(AppError::DiskSpace(format!("need up to {} MB, {} MB free",
                needed / 1_048_576, free / 1_048_576)));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_states() {
        let tmp = tempfile::tempdir().unwrap();
        let dirs = GameDirs::new(tmp.path().to_path_buf());
        dirs.ensure().unwrap();
        assert_eq!(status(&dirs, "1.21.1"), InstallStatus::NotInstalled);
        let d = dirs.versions.join("1.21.1");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("1.21.1.json"), "{}").unwrap();
        assert_eq!(status(&dirs, "1.21.1"), InstallStatus::Incomplete);
        std::fs::write(d.join(MARKER), "{}").unwrap();
        assert_eq!(status(&dirs, "1.21.1"), InstallStatus::Installed);
        assert_eq!(status(&dirs, "../x"), InstallStatus::NotInstalled);
    }
}
