//! Forge / NeoForge installation: download the project's official installer from its maven,
//! verify it against the published `.sha1`, then run it headlessly (`--installClient <dir>`)
//! with the Java runtime that matches the Minecraft version. The installer downloads libraries
//! and runs its own processors; Star Client then reads the generated profile JSON.
use super::{forge_like_matches, installer_url};
use crate::downloads::{DownloadTask, Downloader, Progress};
use crate::error::{AppError, AppResult};
use crate::instances::LoaderKind;
use crate::minecraft::install::Sink;
use crate::paths::{validate_id, GameDirs};
use std::collections::VecDeque;
use std::io::Read;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};

const DONE_MARKER: &str = ".star-loader-installed";
const INSTALL_TIMEOUT: Duration = Duration::from_secs(20 * 60);

fn slug(kind: LoaderKind) -> &'static str {
    match kind { LoaderKind::NeoForge => "neoforge", _ => "forge" }
}

/// Version id that the installer will create, read from its `install_profile.json`.
pub fn parse_profile_id(raw: &str) -> AppResult<String> {
    let v: serde_json::Value = serde_json::from_str(raw)?;
    let id = v["version"].as_str()
        .or_else(|| v["versionInfo"]["id"].as_str())
        .or_else(|| v["install"]["target"].as_str())
        .ok_or_else(|| AppError::InvalidData("installer does not name the version it creates".into()))?;
    validate_id(id)?;
    Ok(id.to_string())
}

pub fn profile_id_from_installer(jar: &Path) -> AppResult<String> {
    let file = std::fs::File::open(jar)?;
    let mut zip = zip::ZipArchive::new(file)?;
    let mut raw = String::new();
    {
        let mut entry = zip.by_name("install_profile.json")
            .map_err(|_| AppError::InvalidData("installer has no install_profile.json".into()))?;
        if entry.size() > 16 * 1024 * 1024 {
            return Err(AppError::InvalidData("install_profile.json is unexpectedly large".into()));
        }
        entry.read_to_string(&mut raw)?;
    }
    parse_profile_id(&raw)
}

fn is_done(dirs: &GameDirs, id: &str) -> bool {
    let d = dirs.versions.join(id);
    d.join(format!("{id}.json")).is_file() && d.join(DONE_MARKER).is_file()
}

fn pump<R: tokio::io::AsyncRead + Unpin + Send + 'static>(r: R, tail: Arc<Mutex<VecDeque<String>>>) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut lines = BufReader::new(r).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let mut t = tail.lock().unwrap();
            if t.len() >= 30 { t.pop_front(); }
            t.push_back(line);
        }
    })
}

async fn run_installer(java: &Path, jar: &Path, root: &Path, cancel: &AtomicBool, label: &str) -> AppResult<()> {
    let mut cmd = tokio::process::Command::new(java);
    cmd.arg("-jar").arg(jar).arg("--installClient").arg(root)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let mut child = cmd.spawn()
        .map_err(|e| AppError::Java(format!("could not start Java for the {label} installer: {e}")))?;
    let tail = Arc::new(Mutex::new(VecDeque::<String>::new()));
    let mut pumps = Vec::new();
    if let Some(o) = child.stdout.take() { pumps.push(pump(o, tail.clone())); }
    if let Some(e) = child.stderr.take() { pumps.push(pump(e, tail.clone())); }

    let started = Instant::now();
    let status = loop {
        if cancel.load(Ordering::Relaxed) { let _ = child.kill().await; return Err(AppError::Cancelled); }
        if started.elapsed() > INSTALL_TIMEOUT {
            let _ = child.kill().await;
            return Err(AppError::Network(format!("the {label} installer did not finish in 20 minutes")));
        }
        match tokio::time::timeout(Duration::from_millis(500), child.wait()).await {
            Ok(r) => break r?,
            Err(_) => continue,
        }
    };
    for p in pumps { let _ = p.await; }
    if !status.success() {
        let text = tail.lock().unwrap().iter().cloned().collect::<Vec<_>>().join("\n");
        tracing::error!("{label} installer failed: {text}");
        return Err(AppError::InvalidData(format!(
            "the {label} installer failed (exit {:?}). Last output:\n{}", status.code(), crate::auth::redact::redact(&text))));
    }
    Ok(())
}

/// Installs Forge/NeoForge for `game` and returns the version id of the generated profile.
/// Already-completed installs are detected and skipped.
pub async fn install(
    dl: &Downloader,
    dirs: &GameDirs,
    kind: LoaderKind,
    game: &str,
    loader_version: &str,
    java: &Path,
    cancel: Arc<AtomicBool>,
    sink: Sink,
) -> AppResult<String> {
    validate_id(game)?;
    validate_id(loader_version)?;
    if !forge_like_matches(kind, loader_version, game) {
        return Err(AppError::Validation(format!("{} {loader_version} is not a build for Minecraft {game}", slug(kind))));
    }
    dirs.ensure()?;
    let label = if kind == LoaderKind::NeoForge { "NeoForge" } else { "Forge" };
    let url = installer_url(kind, game, loader_version);
    let dir = dirs.root.join("installers");
    std::fs::create_dir_all(&dir)?;
    let file = dir.join(format!("{}-{loader_version}-installer.jar", slug(kind)));

    // Published checksum (optional: if the maven has none we still download over https).
    let sha1 = dl.get_text(&format!("{url}.sha1")).await.ok()
        .and_then(|t| t.split_whitespace().next().map(|s| s.to_ascii_lowercase()))
        .filter(|s| s.len() == 40 && s.chars().all(|c| c.is_ascii_hexdigit()));
    dl.run(&format!("{label} installer"),
        vec![DownloadTask { url: url.clone(), dest: file.clone(), sha1, size: None }],
        cancel.clone(), sink.clone()).await?;

    let profile_id = profile_id_from_installer(&file)?;
    if is_done(dirs, &profile_id) { return Ok(profile_id); }

    // The installer refuses to run without a launcher profile registry in the target directory.
    let lp = dirs.root.join("launcher_profiles.json");
    if !lp.exists() {
        crate::config::write_atomic(&lp, br#"{"profiles":{},"settings":{},"version":3}"#)?;
    }
    sink(&Progress::new(&format!("Installing {label}"), &[]));
    run_installer(java, &file, &dirs.root, &cancel, label).await?;

    let vdir = dirs.versions.join(&profile_id);
    if !vdir.join(format!("{profile_id}.json")).is_file() {
        return Err(AppError::InvalidData(format!("the {label} installer finished but did not create {profile_id}")));
    }
    crate::config::write_atomic(&vdir.join(DONE_MARKER), chrono::Utc::now().to_rfc3339().as_bytes())?;
    Ok(profile_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modern_profile_id() {
        assert_eq!(parse_profile_id(r#"{"spec":1,"version":"1.20.1-forge-47.2.0"}"#).unwrap(), "1.20.1-forge-47.2.0");
        assert_eq!(parse_profile_id(r#"{"version":"neoforge-21.1.77"}"#).unwrap(), "neoforge-21.1.77");
    }

    #[test]
    fn legacy_profile_id() {
        assert_eq!(parse_profile_id(r#"{"versionInfo":{"id":"1.12.2-forge1.12.2-14.23.5.2860"}}"#).unwrap(), "1.12.2-forge1.12.2-14.23.5.2860");
        assert_eq!(parse_profile_id(r#"{"install":{"target":"1.7.10-Forge10.13.4.1614-1.7.10"}}"#).unwrap(), "1.7.10-Forge10.13.4.1614-1.7.10");
    }

    #[test]
    fn rejects_unsafe_or_missing_id() {
        assert!(parse_profile_id(r#"{"version":"../x"}"#).is_err());
        assert!(parse_profile_id("{}").is_err());
    }
}
