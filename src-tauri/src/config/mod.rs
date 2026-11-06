//! Versioned, validated launcher settings. Never contains secrets.
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub const SETTINGS_SCHEMA: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub schema_version: u32,
    pub appearance: Appearance,
    pub minecraft: MinecraftSettings,
    pub java: JavaSettings,
    pub downloads: DownloadSettings,
    pub general: GeneralSettings,
    pub last_instance_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GeneralSettings {
    pub auto_start: bool,
    pub window_decorations: bool,
    /// "disabled" | "minimize" | "close"
    pub tray_behavior: String,
    /// "normal" | "always_on_top"
    pub window_position: String,
    pub discord_rpc: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Appearance {
    pub language: String,
    pub accent: String,
    pub reduced_motion: bool,
    pub background: String,
    pub dynamic_accent: bool,
    pub corner_radius: u32,
    pub opacity: u32,
    /// "ltr" | "rtl"
    pub direction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MinecraftSettings {
    pub game_dir: Option<String>,
    pub preferred_channel: String,
    pub show_snapshots: bool,
    pub show_old_beta: bool,
    pub show_old_alpha: bool,
    pub default_loader: String,
    pub width: u32,
    pub height: u32,
    pub fullscreen: bool,
    pub close_launcher_on_start: bool,
    /// "keep" | "hide" | "close"
    pub post_launch: String,
    pub use_default_resolution: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct JavaSettings {
    pub auto: bool,
    pub custom_path: Option<String>,
    pub min_memory_mb: u32,
    pub max_memory_mb: u32,
    /// Extra JVM arguments applied to every instance (whitespace separated).
    pub jvm_args: String,
    pub java_paths: Vec<String>,
    /// "automatic" | "integrated" | "dedicated"
    pub gpu_preference: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DownloadSettings {
    pub concurrency: u32,
    pub retries: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA,
            appearance: Appearance::default(),
            minecraft: MinecraftSettings::default(),
            java: JavaSettings::default(),
            downloads: DownloadSettings::default(),
            general: GeneralSettings::default(),
            last_instance_id: None,
        }
    }
}
impl Default for Appearance {
    fn default() -> Self {
        Self {
            language: "en".into(), accent: "white".into(), reduced_motion: false, background: "aurora".into(),
            dynamic_accent: false, corner_radius: 12, opacity: 100, direction: "ltr".into(),
        }
    }
}
impl Default for GeneralSettings {
    fn default() -> Self {
        Self { auto_start: false, window_decorations: false, tray_behavior: "disabled".into(), window_position: "normal".into(), discord_rpc: false }
    }
}
impl Default for MinecraftSettings {
    fn default() -> Self {
        Self {
            game_dir: None,
            preferred_channel: "release".into(),
            show_snapshots: false,
            show_old_beta: false,
            show_old_alpha: false,
            default_loader: "vanilla".into(),
            width: 854,
            height: 480,
            fullscreen: false,
            close_launcher_on_start: false,
            post_launch: "keep".into(),
            use_default_resolution: true,
        }
    }
}
impl Default for JavaSettings {
    fn default() -> Self {
        Self { auto: true, custom_path: None, min_memory_mb: 512, max_memory_mb: 2048, jvm_args: String::new(), java_paths: Vec::new(), gpu_preference: "automatic".into() }
    }
}
impl Default for DownloadSettings {
    fn default() -> Self {
        Self { concurrency: 8, retries: 3 }
    }
}

impl Settings {
    /// Clamp everything to sane bounds. `total_ram_mb` lets us cap heap size to the machine.
    pub fn validated(mut self, total_ram_mb: Option<u64>) -> Self {
        let a = &mut self.appearance;
        if a.language != "en" { a.language = "en".into(); }
        if a.accent == "orange" { a.accent = "white".into(); }
        if !matches!(a.accent.as_str(), "white" | "amber" | "rose" | "sky" | "emerald") { a.accent = "white".into(); }
        if !matches!(a.background.as_str(), "aurora" | "voxel" | "minimal") { a.background = "aurora".into(); }
        a.corner_radius = a.corner_radius.clamp(0, 30);
        a.opacity = a.opacity.clamp(50, 100);
        if !matches!(a.direction.as_str(), "ltr" | "rtl") { a.direction = "ltr".into(); }
        let g = &mut self.general;
        if !matches!(g.tray_behavior.as_str(), "disabled" | "minimize" | "close") { g.tray_behavior = "disabled".into(); }
        if !matches!(g.window_position.as_str(), "normal" | "always_on_top") { g.window_position = "normal".into(); }
        let m = &mut self.minecraft;
        if !matches!(m.post_launch.as_str(), "keep" | "hide" | "close") { m.post_launch = "keep".into(); }
        // `close_launcher_on_start` predates `post_launch`; keep the two in agreement.
        if m.close_launcher_on_start && m.post_launch == "keep" { m.post_launch = "close".into(); }
        m.close_launcher_on_start = m.post_launch == "close";
        if !matches!(m.preferred_channel.as_str(), "release" | "snapshot") { m.preferred_channel = "release".into(); }
        if !matches!(m.default_loader.as_str(), "vanilla" | "fabric" | "quilt") { m.default_loader = "vanilla".into(); }
        m.width = m.width.clamp(320, 7680);
        m.height = m.height.clamp(240, 4320);
        if m.game_dir.as_deref().map_or(false, |d| d.trim().is_empty()) { m.game_dir = None; }
        let j = &mut self.java;
        let cap = total_ram_mb.map(|r| (r.saturating_sub(1024)).max(1024) as u32).unwrap_or(32768);
        j.max_memory_mb = j.max_memory_mb.clamp(512, cap.max(512));
        j.min_memory_mb = j.min_memory_mb.clamp(256, j.max_memory_mb);
        if j.custom_path.as_deref().map_or(false, |p| p.trim().is_empty()) { j.custom_path = None; }
        j.jvm_args = j.jvm_args.trim().chars().filter(|c| *c != '\0').take(2048).collect();
        let mut seen = std::collections::HashSet::new();
        j.java_paths = j.java_paths.iter().map(|p| p.trim().to_string()).filter(|p| !p.is_empty() && p.len() <= 1024 && seen.insert(p.clone())).take(16).collect();
        if !matches!(j.gpu_preference.as_str(), "automatic" | "integrated" | "dedicated") { j.gpu_preference = "automatic".into(); }
        let d = &mut self.downloads;
        d.concurrency = d.concurrency.clamp(1, 32);
        d.retries = d.retries.clamp(0, 10);
        self.schema_version = SETTINGS_SCHEMA;
        self
    }
}

/// Migrate older JSON layouts forward. v1 stored a flat `{ "language", "maxMemory" }` object.
pub fn migrate(mut v: Value) -> Value {
    let version = v.get("schemaVersion").and_then(Value::as_u64).unwrap_or(1);
    if version < 2 {
        let mut out = serde_json::json!({ "schemaVersion": 2 });
        if let Some(lang) = v.get("language").cloned() { out["appearance"] = serde_json::json!({ "language": lang }); }
        if let Some(mem) = v.get("maxMemory").cloned() { out["java"] = serde_json::json!({ "maxMemoryMb": mem }); }
        if let Some(dir) = v.get("gameDir").cloned() { out["minecraft"] = serde_json::json!({ "gameDir": dir }); }
        v = out;
    }
    v
}

pub struct SettingsFile { path: PathBuf }

impl SettingsFile {
    pub fn new(root: &Path) -> Self { Self { path: root.join("settings.json") } }

    /// Loads settings; a corrupt file is preserved as `settings.corrupt-<ts>.json` and defaults are used.
    pub fn load(&self, total_ram_mb: Option<u64>) -> (Settings, Option<String>) {
        let raw = match std::fs::read_to_string(&self.path) {
            Ok(r) => r,
            Err(_) => return (Settings::default().validated(total_ram_mb), None),
        };
        match serde_json::from_str::<Value>(&raw).map(migrate).and_then(serde_json::from_value::<Settings>) {
            Ok(s) => (s.validated(total_ram_mb), None),
            Err(e) => {
                let backup = self.path.with_file_name(format!("settings.corrupt-{}.json", chrono::Utc::now().timestamp()));
                let _ = std::fs::rename(&self.path, &backup);
                tracing::warn!("settings file was corrupt ({e}); backed up and reset");
                (Settings::default().validated(total_ram_mb), Some(e.to_string()))
            }
        }
    }

    pub fn save(&self, s: &Settings) -> AppResult<()> {
        write_atomic(&self.path, serde_json::to_vec_pretty(s)?.as_slice())
    }
}

/// Write via temp file + rename so a crash never leaves a half-written config.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(p) = path.parent() { std::fs::create_dir_all(p)?; }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let f = SettingsFile::new(dir.path());
        let (s, err) = f.load(Some(16384));
        assert!(err.is_none());
        assert_eq!(s.appearance.language, "en");
        let mut s2 = s.clone();
        s2.appearance.language = "en".into();
        s2.java.max_memory_mb = 4096;
        f.save(&s2).unwrap();
        let (s3, _) = f.load(Some(16384));
        assert_eq!(s3, s2);
    }

    #[test]
    fn corrupt_file_is_backed_up() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("settings.json"), "{not json").unwrap();
        let (s, err) = SettingsFile::new(dir.path()).load(None);
        assert!(err.is_some());
        assert_eq!(s, Settings::default().validated(None));
        let backups: Vec<_> = std::fs::read_dir(dir.path()).unwrap()
            .filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().starts_with("settings.corrupt-")).collect();
        assert_eq!(backups.len(), 1);
    }

    #[test]
    fn migrates_v1() {
        let v1 = serde_json::json!({ "language": "en", "maxMemory": 3072 });
        let s: Settings = serde_json::from_value(migrate(v1)).unwrap();
        let s = s.validated(Some(8192));
        assert_eq!(s.appearance.language, "en");
        assert_eq!(s.java.max_memory_mb, 3072);
        assert_eq!(s.schema_version, SETTINGS_SCHEMA);
    }

    #[test]
    fn clamps_memory_to_hardware() {
        let mut s = Settings::default();
        s.java.max_memory_mb = 64000;
        s.java.min_memory_mb = 99999;
        let s = s.validated(Some(8192));
        assert_eq!(s.java.max_memory_mb, 7168);
        assert!(s.java.min_memory_mb <= s.java.max_memory_mb);
    }

    #[test]
    fn new_fields_are_clamped_and_synced() {
        let mut s = Settings::default();
        s.appearance.corner_radius = 99;
        s.appearance.opacity = 3;
        s.appearance.direction = "up".into();
        s.minecraft.close_launcher_on_start = true;
        s.java.java_paths = vec![" a ".into(), "a".into(), "".into()];
        let s = s.validated(None);
        assert_eq!(s.appearance.corner_radius, 30);
        assert_eq!(s.appearance.opacity, 50);
        assert_eq!(s.appearance.direction, "ltr");
        assert_eq!(s.minecraft.post_launch, "close");
        assert_eq!(s.java.java_paths, vec!["a".to_string()]);
    }

    #[test]
    fn rejects_unknown_language() {
        let mut s = Settings::default();
        s.appearance.language = "xx".into();
        assert_eq!(s.validated(None).appearance.language, "en");
    }
}
