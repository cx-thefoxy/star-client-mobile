//! Game lifecycle on Android: the JVM runs in the ":jvm" process (see `android.rs`); its output file is tailed here.
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningGame {
    pub instance_id: String,
    pub pid: Option<u32>,
    pub version: String,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLogLine { pub instance_id: String, pub stream: &'static str, pub line: String }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameExit {
    pub instance_id: String,
    pub code: Option<i32>,
    pub crashed: bool,
    pub crash_report: Option<String>,
    pub log_file: String,
}

#[derive(Default, Clone)]
pub struct GameRegistry { inner: Arc<Mutex<HashMap<String, RunningGame>>> }

impl GameRegistry {
    pub async fn is_running(&self, id: &str) -> bool { self.inner.lock().await.contains_key(id) }
    pub async fn list(&self) -> Vec<RunningGame> { self.inner.lock().await.values().cloned().collect() }
    /// Reserve a slot atomically to prevent double launches.
    pub async fn reserve(&self, id: &str, version: &str) -> AppResult<()> {
        let mut g = self.inner.lock().await;
        if g.contains_key(id) { return Err(AppError::AlreadyRunning(id.into())); }
        g.insert(id.into(), RunningGame { instance_id: id.into(), pid: None, version: version.into(), started_at: chrono::Utc::now().to_rfc3339() });
        Ok(())
    }
    pub async fn set_pid(&self, id: &str, pid: Option<u32>) {
        if let Some(g) = self.inner.lock().await.get_mut(id) { g.pid = pid; }
    }
    pub async fn release(&self, id: &str) { self.inner.lock().await.remove(id); }
}

pub struct Spawn {
    pub instance_id: String,
    /// Unpacked runtime directory (not an executable: the JVM is loaded in-process).
    pub java: PathBuf,
    pub args: Vec<String>,
    pub game_dir: PathBuf,
    pub log_dir: PathBuf,
    pub secret: String,
    pub tmp_dir: PathBuf,
    pub renderer: String,
}

/// Strips the access token and anything that looks like a secret from one log line.
fn clean(line: &str, secret: &str) -> String {
    let line = if !secret.is_empty() && line.contains(secret) { line.replace(secret, "<redacted>") } else { line.to_string() };
    crate::auth::redact::redact(&line)
}

/// Hands the launch to the ":jvm" process and follows its log file: every new line becomes a `game-log` event and the
/// `[exit N]` marker (or the process disappearing) becomes `game-exit`.
pub async fn spawn(app: AppHandle, reg: GameRegistry, s: Spawn) -> AppResult<()> {
    std::fs::create_dir_all(&s.log_dir)?;
    std::fs::create_dir_all(&s.tmp_dir)?;
    let log_path = s.log_dir.join(format!("launch-{}.log", chrono::Local::now().format("%Y%m%d-%H%M%S")));
    std::fs::write(&log_path, b"")?;
    let started = std::time::SystemTime::now();
    crate::android::start_game(crate::android::StartOpts {
        jre: s.java.clone(), log: log_path.clone(), game_dir: s.game_dir.clone(), tmp: s.tmp_dir.clone(), renderer: s.renderer.clone(), args: s.args.clone(),
    })?;
    reg.set_pid(&s.instance_id, None).await;

    let (id, game_dir, secret) = (s.instance_id.clone(), s.game_dir.clone(), s.secret.clone());
    tokio::spawn(async move {
        let mut offset = 0u64;
        let mut partial = String::new();
        let mut code: Option<i32> = None;
        let mut idle_after_death = 0u32;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            if let Ok(mut f) = std::fs::File::open(&log_path) {
                use std::io::{Read, Seek, SeekFrom};
                let len = f.metadata().map(|m| m.len()).unwrap_or(0);
                if len > offset && f.seek(SeekFrom::Start(offset)).is_ok() {
                    let mut buf = Vec::new();
                    let _ = f.take(len - offset).read_to_end(&mut buf);
                    offset = len;
                    partial.push_str(&String::from_utf8_lossy(&buf));
                    while let Some(nl) = partial.find('\n') {
                        let raw: String = partial.drain(..=nl).collect();
                        let line = clean(raw.trim_end_matches(['\n', '\r']), &secret);
                        if let Some(rest) = line.trim().strip_prefix("[exit ") { code = rest.trim_end_matches(']').trim().parse().ok().or(Some(-1)); }
                        if !line.is_empty() { let _ = app.emit("game-log", GameLogLine { instance_id: id.clone(), stream: "stdout", line }); }
                    }
                }
            }
            if code.is_some() { break; }
            // The process can die without writing `[exit` (native crash): give the log a moment to flush, then report it.
            if crate::android::service_died() { idle_after_death += 1; if idle_after_death >= 3 { break; } }
        }
        crate::android::clear_service_died();
        let crash_report = find_crash_report(&game_dir, started);
        let crashed = code.map_or(true, |c| c != 0) || crash_report.is_some();
        tracing::info!("game {id} exited with {code:?}, crashed={crashed}");
        reg.release(&id).await;
        let secs = started.elapsed().map(|d| d.as_secs()).unwrap_or(0);
        if let Some(st) = app.try_state::<Arc<crate::state::AppState>>() {
            if let Err(e) = st.instances.lock().await.record_playtime(&id, secs) { tracing::warn!("could not record playtime: {e}"); }
        }
        let _ = app.emit("game-exit", GameExit { instance_id: id, code, crashed, crash_report: crash_report.map(|p| p.display().to_string()), log_file: log_path.display().to_string() });
    });
    Ok(())
}

/// Newest crash report or JVM error log written after `since`.
pub fn find_crash_report(game_dir: &Path, since: std::time::SystemTime) -> Option<PathBuf> {
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    let mut consider = |p: PathBuf| {
        if let Ok(m) = std::fs::metadata(&p).and_then(|m| m.modified()) {
            if m >= since && best.as_ref().map_or(true, |(t, _)| m > *t) { best = Some((m, p)); }
        }
    };
    if let Ok(rd) = std::fs::read_dir(game_dir.join("crash-reports")) {
        for e in rd.flatten() { consider(e.path()); }
    }
    if let Ok(rd) = std::fs::read_dir(game_dir) {
        for e in rd.flatten() {
            if e.file_name().to_string_lossy().starts_with("hs_err_pid") { consider(e.path()); }
        }
    }
    best.map(|(_, p)| p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn registry_prevents_double_launch() {
        let r = GameRegistry::default();
        r.reserve("a", "1.21.1").await.unwrap();
        assert!(matches!(r.reserve("a", "1.21.1").await, Err(AppError::AlreadyRunning(_))));
        r.release("a").await;
        assert!(r.reserve("a", "1.21.1").await.is_ok());
    }

    #[test]
    fn crash_report_discovery() {
        let d = tempfile::tempdir().unwrap();
        let since = std::time::SystemTime::now() - std::time::Duration::from_secs(5);
        assert!(find_crash_report(d.path(), since).is_none());
        std::fs::create_dir_all(d.path().join("crash-reports")).unwrap();
        std::fs::write(d.path().join("crash-reports/crash-1.txt"), "x").unwrap();
        assert!(find_crash_report(d.path(), since).is_some());
    }
}
