use crate::downloads::DownloadTask;
use crate::error::{AppError, AppResult};
use crate::paths::safe_join;
use serde::Deserialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub const RESOURCES_URL: &str = "https://resources.download.minecraft.net";

#[derive(Debug, Deserialize)]
pub struct AssetIndex {
    pub objects: HashMap<String, AssetObject>,
    #[serde(default, rename = "virtual")]
    pub is_virtual: bool,
    #[serde(default)]
    pub map_to_resources: bool,
}

#[derive(Debug, Deserialize)]
pub struct AssetObject {
    pub hash: String,
    pub size: u64,
}

fn valid_hash(h: &str) -> bool { h.len() == 40 && h.chars().all(|c| c.is_ascii_hexdigit()) }

pub fn object_path(assets: &Path, hash: &str) -> PathBuf {
    assets.join("objects").join(&hash[..2]).join(hash)
}

pub fn tasks(index: &AssetIndex, assets: &Path) -> AppResult<Vec<DownloadTask>> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for obj in index.objects.values() {
        if !valid_hash(&obj.hash) { return Err(AppError::InvalidData(format!("bad asset hash {}", obj.hash))); }
        if !seen.insert(obj.hash.clone()) { continue; }
        out.push(DownloadTask {
            url: format!("{RESOURCES_URL}/{}/{}", &obj.hash[..2], obj.hash),
            dest: object_path(assets, &obj.hash),
            sha1: Some(obj.hash.clone()),
            size: Some(obj.size),
        });
    }
    Ok(out)
}

/// Pre-1.7 versions read assets by name. Copy hashed objects into the virtual or resources dir.
/// Returns the directory to pass as `${game_assets}`.
pub fn materialize_legacy(index: &AssetIndex, index_id: &str, assets: &Path, game_dir: &Path) -> AppResult<PathBuf> {
    let target = if index.map_to_resources {
        game_dir.join("resources")
    } else if index.is_virtual {
        assets.join("virtual").join(crate::paths::validate_id(index_id)?)
    } else {
        return Ok(assets.join("virtual").join("legacy"));
    };
    for (name, obj) in &index.objects {
        let dest = safe_join(&target, name)?;
        if dest.exists() { continue; }
        if let Some(p) = dest.parent() { std::fs::create_dir_all(p)?; }
        std::fs::copy(object_path(assets, &obj.hash), &dest)?;
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_tasks_and_dedupes() {
        let idx: AssetIndex = serde_json::from_value(serde_json::json!({
            "objects": {
                "a.png": { "hash": "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d", "size": 5 },
                "b.png": { "hash": "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d", "size": 5 }
            }
        })).unwrap();
        let t = tasks(&idx, Path::new("/as")).unwrap();
        assert_eq!(t.len(), 1);
        assert_eq!(t[0].url, "https://resources.download.minecraft.net/aa/aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d");
    }

    #[test]
    fn rejects_bad_hash() {
        let idx: AssetIndex = serde_json::from_value(serde_json::json!({
            "objects": { "a": { "hash": "../../x", "size": 1 } }
        })).unwrap();
        assert!(tasks(&idx, Path::new("/as")).is_err());
    }
}
