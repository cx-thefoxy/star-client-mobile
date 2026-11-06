//! Mojang version manifest v2: https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
use crate::downloads::Downloader;
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct VersionManifest {
    pub latest: Latest,
    pub versions: Vec<ManifestEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Latest {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestEntry {
    pub id: String,
    /// Raw Mojang type: `release`, `snapshot`, `old_beta`, `old_alpha` (kept as string to survive new types).
    #[serde(rename = "type")]
    pub kind: String,
    pub url: String,
    pub time: String,
    pub release_time: String,
    #[serde(default)]
    pub sha1: Option<String>,
    #[serde(default)]
    pub compliance_level: Option<u32>,
}

/// Display category. Mojang files pre-releases and RCs under `snapshot`; we refine by id.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Release,
    Snapshot,
    PreRelease,
    ReleaseCandidate,
    OldBeta,
    OldAlpha,
    Other,
}

pub fn categorize(e: &ManifestEntry) -> Category {
    match e.kind.as_str() {
        "release" => Category::Release,
        "old_beta" => Category::OldBeta,
        "old_alpha" => Category::OldAlpha,
        "snapshot" => {
            let id = e.id.to_ascii_lowercase();
            if id.contains("-rc") || id.contains(" release candidate") {
                Category::ReleaseCandidate
            } else if id.contains("-pre") || id.contains(" pre-release") {
                Category::PreRelease
            } else {
                Category::Snapshot
            }
        }
        _ => Category::Other,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedManifest {
    pub fetched_at: i64,
    pub manifest: VersionManifest,
}

/// Fetch the manifest, using a 10 minute cache. Falls back to the cached copy if offline.
/// Returns `(manifest, served_from_stale_cache)`.
pub async fn load(dl: &Downloader, cache_dir: &Path, force: bool) -> AppResult<(VersionManifest, bool)> {
    let path = cache_dir.join("version_manifest_v2.json");
    let cached: Option<CachedManifest> = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok());
    let now = chrono::Utc::now().timestamp();
    if let Some(c) = &cached {
        if !force && now - c.fetched_at < 600 {
            return Ok((c.manifest.clone(), false));
        }
    }
    match dl.get_json::<VersionManifest>(MANIFEST_URL).await {
        Ok(m) => {
            validate(&m)?;
            let c = CachedManifest { fetched_at: now, manifest: m.clone() };
            crate::config::write_atomic(&path, &serde_json::to_vec(&c)?)?;
            Ok((m, false))
        }
        Err(e) => match cached {
            Some(c) => {
                tracing::warn!("manifest refresh failed, using cache: {e}");
                Ok((c.manifest, true))
            }
            None => Err(e),
        },
    }
}

/// Reject obviously malformed manifests instead of rendering garbage.
pub fn validate(m: &VersionManifest) -> AppResult<()> {
    use crate::error::AppError;
    if m.versions.is_empty() {
        return Err(AppError::InvalidData("manifest has no versions".into()));
    }
    for v in &m.versions {
        crate::paths::validate_id(&v.id)?;
        crate::downloads::ensure_trusted_url(&v.url)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> VersionManifest {
        serde_json::from_str(include_str!("../../../tests/fixtures/version_manifest_v2.json")).unwrap()
    }

    #[test]
    fn parses_fixture() {
        let m = fixture();
        validate(&m).unwrap();
        assert_eq!(m.latest.release, "1.21.1");
        assert!(m.versions.iter().any(|v| v.kind == "old_alpha"));
    }

    #[test]
    fn categories() {
        let m = fixture();
        let cat = |id: &str| categorize(m.versions.iter().find(|v| v.id == id).unwrap());
        assert_eq!(cat("1.21.1"), Category::Release);
        assert_eq!(cat("24w14a"), Category::Snapshot);
        assert_eq!(cat("1.21-pre1"), Category::PreRelease);
        assert_eq!(cat("1.21-rc1"), Category::ReleaseCandidate);
        assert_eq!(cat("1.14 Pre-Release 1"), Category::PreRelease);
        assert_eq!(cat("b1.7.3"), Category::OldBeta);
        assert_eq!(cat("rd-132211"), Category::OldAlpha);
    }

    #[test]
    fn unknown_type_survives() {
        let e: ManifestEntry = serde_json::from_value(serde_json::json!({
            "id": "x1", "type": "experiment", "url": "https://piston-meta.mojang.com/x.json",
            "time": "t", "releaseTime": "t"
        })).unwrap();
        assert_eq!(categorize(&e), Category::Other);
    }
}
