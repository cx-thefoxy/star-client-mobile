//! Bridge between the launcher and the Star HUD Fabric mod (see /star-mod).
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Versions the mod source targets. `verified` stays false until a build has been run in-game.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StarCompat { pub minecraft: &'static str, pub loader: &'static str, pub jar: &'static str, pub verified: bool }

pub const COMPAT: &[StarCompat] = &[StarCompat { minecraft: "1.21.1", loader: "fabric", jar: "star-hud-1.21.1.jar", verified: false }];

pub fn compat_for(mc: &str, loader: &str) -> Option<&'static StarCompat> {
    COMPAT.iter().find(|c| c.minecraft == mc && c.loader == loader)
}

pub fn bundled_jar(resource_dir: Option<&Path>, c: &StarCompat) -> Option<PathBuf> {
    let candidates = [
        resource_dir.map(|r| r.join("star-mod").join(c.jar)),
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../star-mod/dist").join(c.jar)),
    ];
    candidates.into_iter().flatten().find(|p| p.is_file())
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct HudConfig {
    pub fps: bool, pub coords: bool, pub cps: bool, pub keystrokes: bool, pub ping: bool, pub armor: bool,
    pub toggle_sprint: bool, pub zoom: bool, pub zoom_factor: f32, pub text_color: String,
}
impl Default for HudConfig {
    fn default() -> Self {
        Self { fps: true, coords: true, cps: true, keystrokes: true, ping: true, armor: true,
            toggle_sprint: false, zoom: true, zoom_factor: 4.0, text_color: "#FFFFFF".into() }
    }
}
impl HudConfig {
    pub fn validated(mut self) -> Self {
        self.zoom_factor = self.zoom_factor.clamp(1.5, 10.0);
        let ok = self.text_color.len() == 7 && self.text_color.starts_with('#') && self.text_color[1..].chars().all(|c| c.is_ascii_hexdigit());
        if !ok { self.text_color = "#FFFFFF".into(); }
        self
    }
}

pub fn read_config(game_dir: &Path) -> HudConfig {
    std::fs::read(game_dir.join("config/star-client.json")).ok()
        .and_then(|b| serde_json::from_slice::<HudConfig>(&b).ok())
        .map(HudConfig::validated)
        .unwrap_or_default()
}

pub fn write_config(game_dir: &Path, c: HudConfig) -> AppResult<HudConfig> {
    let c = c.validated();
    crate::config::write_atomic(&game_dir.join("config/star-client.json"), &serde_json::to_vec_pretty(&c)?)?;
    Ok(c)
}

/// Copies the bundled jar into the instance as `star-hud.jar`, or removes our copy when disabled.
/// Only touches the file named `star-hud.jar`.
pub fn sync(game_dir: &Path, mc: &str, loader: &str, enabled: bool, resource_dir: Option<&Path>) -> AppResult<()> {
    let target = game_dir.join("mods").join("star-hud.jar");
    if !enabled {
        if target.exists() { std::fs::remove_file(&target)?; }
        return Ok(());
    }
    let c = compat_for(mc, loader).ok_or_else(|| AppError::Unsupported(format!("Star HUD is not available for {loader} {mc}")))?;
    let jar = bundled_jar(resource_dir, c).ok_or_else(|| AppError::NotFound(
        "Star HUD jar is not bundled with this build. Build /star-mod (see docs/STAR_MOD.md) and rebuild the launcher.".into()))?;
    std::fs::create_dir_all(target.parent().unwrap())?;
    let same = target.exists() && crate::downloads::sha1_file(&target)? == crate::downloads::sha1_file(&jar)?;
    if !same { std::fs::copy(&jar, &target)?; }
    if !game_dir.join("config/star-client.json").exists() { write_config(game_dir, HudConfig::default())?; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compat_lookup() {
        assert!(compat_for("1.21.1", "fabric").is_some());
        assert!(compat_for("1.8.9", "fabric").is_none());
        assert!(compat_for("1.21.1", "quilt").is_none());
    }

    #[test]
    fn config_roundtrip_and_validation() {
        let t = tempfile::tempdir().unwrap();
        let mut c = HudConfig::default();
        c.zoom_factor = 99.0; c.text_color = "red".into();
        let saved = write_config(t.path(), c).unwrap();
        assert_eq!(saved.zoom_factor, 10.0);
        assert_eq!(saved.text_color, "#FFFFFF");
        assert_eq!(read_config(t.path()), saved);
    }

    #[test]
    fn disabling_removes_only_our_jar() {
        let t = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(t.path().join("mods")).unwrap();
        std::fs::write(t.path().join("mods/star-hud.jar"), "x").unwrap();
        std::fs::write(t.path().join("mods/other.jar"), "y").unwrap();
        sync(t.path(), "1.21.1", "fabric", false, None).unwrap();
        assert!(!t.path().join("mods/star-hud.jar").exists());
        assert!(t.path().join("mods/other.jar").exists());
    }
}
