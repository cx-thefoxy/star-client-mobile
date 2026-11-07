use crate::error::{AppError, AppResult};
use std::path::{Component, Path, PathBuf};

/// Launcher-owned directories. Minecraft data lives under `game_root` (configurable).
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub root: PathBuf,
    pub logs: PathBuf,
    pub cache: PathBuf,
    pub runtimes: PathBuf,
    pub trash: PathBuf,
    pub default_game_root: PathBuf,
}

impl AppPaths {
    /// `root` is the app's private data directory (Tauri `app_data_dir`).
    pub fn resolve(root: PathBuf) -> AppResult<Self> {
        if root.as_os_str().is_empty() { return Err(AppError::NotFound("app data directory".into())); }
        Ok(Self::from_root(root))
    }

    pub fn from_root(root: PathBuf) -> Self {
        Self {
            logs: root.join("logs"),
            cache: root.join("cache"),
            runtimes: root.join("runtimes"),
            trash: root.join("trash"),
            default_game_root: root.join("minecraft"),
            root,
        }
    }

    pub fn ensure(&self) -> AppResult<()> {
        for d in [&self.root, &self.logs, &self.cache, &self.runtimes, &self.trash] {
            std::fs::create_dir_all(d)?;
        }
        Ok(())
    }
}

/// Shared Minecraft directories under the selected game root.
#[derive(Debug, Clone)]
pub struct GameDirs {
    pub root: PathBuf,
    pub versions: PathBuf,
    pub libraries: PathBuf,
    pub assets: PathBuf,
    pub instances: PathBuf,
}

impl GameDirs {
    pub fn new(root: PathBuf) -> Self {
        Self {
            versions: root.join("versions"),
            libraries: root.join("libraries"),
            assets: root.join("assets"),
            instances: root.join("instances"),
            root,
        }
    }
    pub fn ensure(&self) -> AppResult<()> {
        for d in [&self.root, &self.versions, &self.libraries, &self.assets, &self.instances] {
            std::fs::create_dir_all(d)?;
        }
        Ok(())
    }
}

/// Accepts Minecraft/loader identifiers such as `1.21.1`, `b1.7.3`, `fabric-loader-0.16.5-1.21.1`,
/// `1.14 Pre-Release 1`. Rejects separators and traversal.
pub fn validate_id(id: &str) -> AppResult<&str> {
    let ok = !id.is_empty()
        && id.len() <= 128
        && id != "."
        && !id.contains("..")
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+' | ' '));
    if ok {
        Ok(id)
    } else {
        Err(AppError::Validation(format!("invalid identifier: {id:?}")))
    }
}

/// Joins an untrusted relative path (from metadata) under `base`, rejecting absolute paths,
/// drive prefixes and `..` components.
pub fn safe_join(base: &Path, rel: &str) -> AppResult<PathBuf> {
    let rel_path = Path::new(rel);
    let mut out = base.to_path_buf();
    for comp in rel_path.components() {
        match comp {
            Component::Normal(c) => out.push(c),
            Component::CurDir => {}
            _ => return Err(AppError::Validation(format!("unsafe path in metadata: {rel:?}"))),
        }
    }
    if out == base {
        return Err(AppError::Validation("empty path".into()));
    }
    Ok(out)
}

/// Replace the user's home directory with `~` for diagnostic output.
pub fn anonymize(p: &Path) -> String {
    let s = p.display().to_string();
    match dirs::home_dir() {
        Some(h) => s.replace(&h.display().to_string(), "~"),
        None => s,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids() {
        assert!(validate_id("1.21.1").is_ok());
        assert!(validate_id("b1.7.3").is_ok());
        assert!(validate_id("1.14 Pre-Release 1").is_ok());
        assert!(validate_id("fabric-loader-0.16.5-1.21.1").is_ok());
        assert!(validate_id("../evil").is_err());
        assert!(validate_id("a/b").is_err());
        assert!(validate_id("a\\b").is_err());
        assert!(validate_id("").is_err());
    }

    #[test]
    fn joins() {
        let base = Path::new("/base");
        assert_eq!(safe_join(base, "a/b.jar").unwrap(), Path::new("/base/a/b.jar"));
        assert!(safe_join(base, "../x").is_err());
        assert!(safe_join(base, "/etc/passwd").is_err());
        assert!(safe_join(base, "a/../../x").is_err());
    }
}
