//! Concurrent, resumable, checksum-verified downloads from an allow-list of official hosts.
use crate::error::{AppError, AppResult};
use futures_util::{stream, StreamExt};
use serde::Serialize;
use sha1::{Digest, Sha1};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

/// Only official Mojang endpoints and project-maintained loader mavens.
pub const TRUSTED_HOSTS: &[&str] = &[
    "piston-meta.mojang.com",
    "piston-data.mojang.com",
    "launchermeta.mojang.com",
    "launcher.mojang.com",
    "libraries.minecraft.net",
    "resources.download.minecraft.net",
    "meta.fabricmc.net",
    "maven.fabricmc.net",
    "meta.quiltmc.org",
    "maven.quiltmc.org",
    "maven.minecraftforge.net",
    "maven.neoforged.net",
    "api.modrinth.com",
    "cdn.modrinth.com",
];

pub fn ensure_trusted_url(raw: &str) -> AppResult<url::Url> {
    let u = url::Url::parse(raw).map_err(|e| AppError::Validation(format!("bad url: {e}")))?;
    if u.scheme() != "https" {
        return Err(AppError::Validation(format!("refusing non-https download: {}", u.host_str().unwrap_or(""))));
    }
    match u.host_str() {
        Some(h) if TRUSTED_HOSTS.contains(&h) => Ok(u),
        h => Err(AppError::Validation(format!("refusing download from untrusted host {:?}", h))),
    }
}

#[derive(Debug, Clone)]
pub struct DownloadTask {
    pub url: String,
    pub dest: PathBuf,
    pub sha1: Option<String>,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: String,
    pub total_files: usize,
    pub done_files: usize,
    pub total_bytes: u64,
    pub done_bytes: u64,
    pub skipped_files: usize,
}

impl Progress {
    pub fn new(phase: &str, tasks: &[DownloadTask]) -> Self {
        Self {
            phase: phase.into(),
            total_files: tasks.len(),
            total_bytes: tasks.iter().filter_map(|t| t.size).sum(),
            ..Default::default()
        }
    }
    pub fn add_bytes(&mut self, n: u64) { self.done_bytes = self.done_bytes.saturating_add(n); }
    pub fn sub_bytes(&mut self, n: u64) { self.done_bytes = self.done_bytes.saturating_sub(n); }
    pub fn file_done(&mut self, skipped: bool) {
        self.done_files = (self.done_files + 1).min(self.total_files);
        if skipped { self.skipped_files += 1; }
    }
    pub fn is_complete(&self) -> bool { self.done_files == self.total_files }
}

/// Returns true only if the file exists and matches every check we know about.
pub fn verify_file(path: &Path, sha1: Option<&str>, size: Option<u64>) -> AppResult<bool> {
    let meta = match std::fs::metadata(path) {
        Ok(m) if m.is_file() => m,
        _ => return Ok(false),
    };
    if let Some(sz) = size {
        if meta.len() != sz { return Ok(false); }
    }
    if let Some(expected) = sha1 {
        return Ok(sha1_file(path)?.eq_ignore_ascii_case(expected));
    }
    Ok(true)
}

pub fn sha1_file(path: &Path) -> AppResult<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha1::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 { break; }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

fn part_path(dest: &Path) -> PathBuf {
    let mut s = dest.as_os_str().to_owned();
    s.push(".part");
    PathBuf::from(s)
}

type Sink = Arc<dyn Fn(&Progress) + Send + Sync>;

struct Shared {
    progress: Mutex<Progress>,
    last_emit: Mutex<Instant>,
    sink: Sink,
}

impl Shared {
    fn update(&self, force: bool, f: impl FnOnce(&mut Progress)) {
        let snapshot = {
            let mut p = self.progress.lock().unwrap();
            f(&mut p);
            p.clone()
        };
        let mut last = self.last_emit.lock().unwrap();
        if force || last.elapsed() >= Duration::from_millis(120) {
            *last = Instant::now();
            (self.sink)(&snapshot);
        }
    }
}

#[derive(Clone)]
pub struct Downloader {
    client: reqwest::Client,
    concurrency: usize,
    retries: u32,
}

impl Downloader {
    pub fn new(client: reqwest::Client, concurrency: u32, retries: u32) -> Self {
        Self { client, concurrency: concurrency.clamp(1, 32) as usize, retries }
    }

    /// Download all tasks. Fails fast on the first non-recoverable error.
    pub async fn run(
        &self,
        phase: &str,
        tasks: Vec<DownloadTask>,
        cancel: Arc<AtomicBool>,
        sink: Sink,
    ) -> AppResult<Progress> {
        let shared = Arc::new(Shared {
            progress: Mutex::new(Progress::new(phase, &tasks)),
            last_emit: Mutex::new(Instant::now() - Duration::from_secs(1)),
            sink,
        });
        shared.update(true, |_| {});
        let results: Vec<AppResult<()>> = stream::iter(tasks.into_iter().map(|t| {
            let me = self.clone();
            let shared = shared.clone();
            let cancel = cancel.clone();
            async move { me.fetch_one(&t, &cancel, &shared).await }
        }))
        .buffer_unordered(self.concurrency)
        .collect()
        .await;
        for r in results { r?; }
        let p = shared.progress.lock().unwrap().clone();
        (shared.sink)(&p);
        Ok(p)
    }

    async fn fetch_one(&self, t: &DownloadTask, cancel: &AtomicBool, sh: &Shared) -> AppResult<()> {
        if cancel.load(Ordering::Relaxed) { return Err(AppError::Cancelled); }
        let (dest, sha, size) = (t.dest.clone(), t.sha1.clone(), t.size);
        let ok = tokio::task::spawn_blocking(move || verify_file(&dest, sha.as_deref(), size))
            .await
            .map_err(|e| AppError::InvalidData(e.to_string()))??;
        if ok {
            sh.update(false, |p| { p.add_bytes(t.size.unwrap_or(0)); p.file_done(true); });
            return Ok(());
        }
        ensure_trusted_url(&t.url)?;
        if let Some(parent) = t.dest.parent() { tokio::fs::create_dir_all(parent).await?; }
        let mut attempt = 0u32;
        loop {
            let mut counted = 0u64;
            match self.try_download(t, cancel, sh, &mut counted).await {
                Ok(()) => {
                    sh.update(true, |p| p.file_done(false));
                    return Ok(());
                }
                Err(e) => {
                    sh.update(false, |p| p.sub_bytes(counted));
                    if e.is_transient() && attempt < self.retries && !cancel.load(Ordering::Relaxed) {
                        attempt += 1;
                        tracing::warn!("retry {attempt}/{} for {}: {e}", self.retries, t.dest.display());
                        tokio::time::sleep(Duration::from_millis(400 * 2u64.pow(attempt))).await;
                        continue;
                    }
                    return Err(e);
                }
            }
        }
    }

    async fn try_download(&self, t: &DownloadTask, cancel: &AtomicBool, sh: &Shared, counted: &mut u64) -> AppResult<()> {
        let part = part_path(&t.dest);
        let mut existing = tokio::fs::metadata(&part).await.map(|m| m.len()).unwrap_or(0);
        let mut hasher = Sha1::new();
        // Resume only when we know the size and the partial is shorter.
        if existing > 0 && t.size.map_or(true, |s| existing >= s) {
            let _ = tokio::fs::remove_file(&part).await;
            existing = 0;
        }
        if existing > 0 {
            let bytes = tokio::fs::read(&part).await?;
            hasher.update(&bytes);
        }
        let mut req = self.client.get(&t.url);
        if existing > 0 { req = req.header(reqwest::header::RANGE, format!("bytes={existing}-")); }
        let resp = req.send().await?;
        let status = resp.status();
        let append = if status == reqwest::StatusCode::PARTIAL_CONTENT && existing > 0 {
            true
        } else if status.is_success() {
            hasher = Sha1::new();
            existing = 0;
            false
        } else if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
            let _ = tokio::fs::remove_file(&part).await;
            return Err(AppError::NetworkTransient("range not satisfiable, restarting".into()));
        } else if status.is_server_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(AppError::NetworkTransient(format!("HTTP {status}")));
        } else if status == reqwest::StatusCode::NOT_FOUND {
            return Err(AppError::NotFound(format!("file missing on server: {}", file_name(&t.dest))));
        } else {
            return Err(AppError::Network(format!("HTTP {status}")));
        };
        if append { sh.update(false, |p| p.add_bytes(existing)); *counted += existing; }
        let mut file = tokio::fs::OpenOptions::new()
            .create(true).write(true).append(append).truncate(!append)
            .open(&part).await?;
        let mut written = existing;
        let mut body = resp.bytes_stream();
        while let Some(chunk) = body.next().await {
            if cancel.load(Ordering::Relaxed) {
                file.flush().await?;
                return Err(AppError::Cancelled);
            }
            let chunk = chunk?;
            file.write_all(&chunk).await?;
            hasher.update(&chunk);
            written += chunk.len() as u64;
            *counted += chunk.len() as u64;
            let n = chunk.len() as u64;
            sh.update(false, |p| p.add_bytes(n));
        }
        file.flush().await?;
        drop(file);
        if let Some(sz) = t.size {
            if written != sz {
                let _ = tokio::fs::remove_file(&part).await;
                return Err(AppError::Integrity { path: file_name(&t.dest), reason: format!("size {written} != {sz}") });
            }
        }
        if let Some(expected) = &t.sha1 {
            let got = hex::encode(hasher.finalize());
            if !got.eq_ignore_ascii_case(expected) {
                let _ = tokio::fs::remove_file(&part).await;
                return Err(AppError::Integrity { path: file_name(&t.dest), reason: "sha1 mismatch".into() });
            }
        }
        tokio::fs::rename(&part, &t.dest).await?;
        Ok(())
    }

    /// Fetch a small JSON document (metadata) from a trusted host.
    pub async fn get_json<T: serde::de::DeserializeOwned>(&self, url: &str) -> AppResult<T> {
        ensure_trusted_url(url)?;
        let resp = self.client.get(url).send().await?;
        let status = resp.status();
        if !status.is_success() {
            return Err(if status.is_server_error() {
                AppError::NetworkTransient(format!("HTTP {status}"))
            } else if status == reqwest::StatusCode::NOT_FOUND {
                AppError::NotFound("metadata document".into())
            } else {
                AppError::Network(format!("HTTP {status}"))
            });
        }
        Ok(resp.json::<T>().await?)
    }

    pub async fn get_text(&self, url: &str) -> AppResult<String> {
        ensure_trusted_url(url)?;
        let resp = self.client.get(url).send().await?.error_for_status()?;
        Ok(resp.text().await?)
    }
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verify_checks_sha_and_size() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("hello.txt");
        std::fs::write(&f, b"hello").unwrap();
        let sha = "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d";
        assert!(verify_file(&f, Some(sha), Some(5)).unwrap());
        assert!(!verify_file(&f, Some(sha), Some(6)).unwrap());
        assert!(!verify_file(&f, Some("0000000000000000000000000000000000000000"), None).unwrap());
        assert!(!verify_file(&dir.path().join("missing"), None, None).unwrap());
    }

    #[test]
    fn trusted_hosts_only() {
        assert!(ensure_trusted_url("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json").is_ok());
        assert!(ensure_trusted_url("http://piston-meta.mojang.com/x").is_err());
        assert!(ensure_trusted_url("https://evil.example.com/x.jar").is_err());
        assert!(ensure_trusted_url("https://piston-meta.mojang.com.evil.io/x").is_err());
    }

    #[test]
    fn progress_transitions() {
        let tasks = vec![
            DownloadTask { url: "u".into(), dest: "a".into(), sha1: None, size: Some(10) },
            DownloadTask { url: "u".into(), dest: "b".into(), sha1: None, size: Some(5) },
        ];
        let mut p = Progress::new("files", &tasks);
        assert_eq!((p.total_files, p.total_bytes, p.is_complete()), (2, 15, false));
        p.add_bytes(10); p.file_done(true);
        p.add_bytes(3); p.sub_bytes(3); // failed attempt rolled back
        assert_eq!(p.done_bytes, 10);
        p.add_bytes(5); p.file_done(false);
        p.file_done(false); // never exceeds total
        assert!(p.is_complete());
        assert_eq!((p.done_files, p.skipped_files, p.done_bytes), (2, 1, 15));
    }

    #[test]
    fn part_suffix() {
        assert_eq!(part_path(Path::new("/x/a.jar")), PathBuf::from("/x/a.jar.part"));
    }
}
