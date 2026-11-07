//! Isolated game instances (each with its own .minecraft-style directory).
use crate::config::write_atomic;
use crate::error::{AppError, AppResult};
use crate::paths::validate_id;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const INSTANCES_SCHEMA: u32 = 1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LoaderKind { Vanilla, Fabric, Quilt, Forge, NeoForge }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub version_id: String,
    pub loader: LoaderKind,
    #[serde(default)]
    pub loader_version: Option<String>,
    #[serde(default)]
    pub max_memory_mb: Option<u32>,
    #[serde(default)]
    pub java_path: Option<String>,
    #[serde(default)]
    pub jvm_args: Vec<String>,
    #[serde(default)]
    pub resolution: Option<(u32, u32)>,
    #[serde(default)]
    pub fullscreen: Option<bool>,
    #[serde(default)]
    pub star_mod_enabled: bool,
    pub created_at: String,
    #[serde(default)]
    pub last_played: Option<String>,
    #[serde(default)]
    pub play_count: u32,
    #[serde(default)]
    pub playtime_secs: u64,
    #[serde(default)]
    pub favorite: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceDraft {
    pub name: String,
    pub version_id: String,
    pub loader: LoaderKind,
    pub loader_version: Option<String>,
    pub max_memory_mb: Option<u32>,
    pub java_path: Option<String>,
    #[serde(default)]
    pub jvm_args: Vec<String>,
    pub resolution: Option<(u32, u32)>,
    pub fullscreen: Option<bool>,
    #[serde(default)]
    pub star_mod_enabled: bool,
}

impl InstanceDraft {
    pub fn validate(&self) -> AppResult<()> {
        let n = self.name.trim();
        if n.is_empty() || n.chars().count() > 48 || n.chars().any(|c| c.is_control()) {
            return Err(AppError::Validation("instance name must be 1-48 visible characters".into()));
        }
        validate_id(&self.version_id)?;
        match (self.loader, &self.loader_version) {
            (LoaderKind::Vanilla, _) => {}
            (_, Some(v)) => { validate_id(v)?; }
            (_, None) => return Err(AppError::Validation("choose a loader version".into())),
        }
        if let Some(m) = self.max_memory_mb { if !(512..=65536).contains(&m) { return Err(AppError::Validation("memory must be 512-65536 MB".into())); } }
        if let Some((w, h)) = self.resolution { if w < 320 || h < 240 || w > 7680 || h > 4320 { return Err(AppError::Validation("invalid resolution".into())); } }
        crate::minecraft::arguments::validate_extra_jvm_args(&self.jvm_args)?;
        if self.star_mod_enabled && self.loader != LoaderKind::Fabric {
            return Err(AppError::Validation("Star HUD mod requires a Fabric instance".into()));
        }
        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct File { schema_version: u32, instances: Vec<Instance> }

pub struct InstanceStore { path: PathBuf, pub root: PathBuf, items: Vec<Instance> }

impl InstanceStore {
    pub fn load(config_root: &Path, instances_root: &Path) -> Self {
        let path = config_root.join("instances.json");
        let items = std::fs::read(&path).ok()
            .and_then(|b| serde_json::from_slice::<File>(&b).ok())
            .map(|f| f.instances)
            .unwrap_or_default()
            .into_iter()
            .filter(|i| uuid::Uuid::parse_str(&i.id).is_ok())
            .collect();
        Self { path, root: instances_root.to_path_buf(), items }
    }

    fn save(&self) -> AppResult<()> {
        // keep one backup of the previous registry
        if self.path.exists() { let _ = std::fs::copy(&self.path, self.path.with_extension("json.bak")); }
        write_atomic(&self.path, &serde_json::to_vec_pretty(&File { schema_version: INSTANCES_SCHEMA, instances: self.items.clone() })?)
    }

    pub fn list(&self) -> &[Instance] { &self.items }

    pub fn get(&self, id: &str) -> AppResult<&Instance> {
        self.items.iter().find(|i| i.id == id).ok_or_else(|| AppError::NotFound(format!("instance {id}")))
    }

    pub fn game_dir(&self, id: &str) -> AppResult<PathBuf> {
        let uuid = uuid::Uuid::parse_str(id).map_err(|_| AppError::Validation("bad instance id".into()))?;
        Ok(self.root.join(uuid.to_string()))
    }

    pub fn create(&mut self, d: InstanceDraft) -> AppResult<Instance> {
        d.validate()?;
        let inst = Instance {
            id: uuid::Uuid::new_v4().to_string(),
            name: d.name.trim().to_string(),
            version_id: d.version_id, loader: d.loader, loader_version: d.loader_version,
            max_memory_mb: d.max_memory_mb, java_path: d.java_path, jvm_args: d.jvm_args,
            resolution: d.resolution, fullscreen: d.fullscreen, star_mod_enabled: d.star_mod_enabled,
            created_at: chrono::Utc::now().to_rfc3339(), last_played: None,
            play_count: 0, playtime_secs: 0, favorite: false,
        };
        let dir = self.game_dir(&inst.id)?;
        for sub in ["mods", "resourcepacks", "shaderpacks", "saves", "screenshots", "config", "logs"] {
            std::fs::create_dir_all(dir.join(sub))?;
        }
        self.items.push(inst.clone());
        self.save()?;
        Ok(inst)
    }

    pub fn update(&mut self, id: &str, d: InstanceDraft) -> AppResult<Instance> {
        d.validate()?;
        let i = self.items.iter_mut().find(|i| i.id == id).ok_or_else(|| AppError::NotFound(format!("instance {id}")))?;
        i.name = d.name.trim().to_string();
        i.version_id = d.version_id; i.loader = d.loader; i.loader_version = d.loader_version;
        i.max_memory_mb = d.max_memory_mb; i.java_path = d.java_path; i.jvm_args = d.jvm_args;
        i.resolution = d.resolution; i.fullscreen = d.fullscreen; i.star_mod_enabled = d.star_mod_enabled;
        let out = i.clone();
        self.save()?;
        Ok(out)
    }

    pub fn touch_played(&mut self, id: &str) -> AppResult<()> {
        if let Some(i) = self.items.iter_mut().find(|i| i.id == id) {
            i.last_played = Some(chrono::Utc::now().to_rfc3339());
            i.play_count = i.play_count.saturating_add(1);
        }
        self.save()
    }

    /// Adds a finished session's wall-clock duration to the instance playtime.
    pub fn record_playtime(&mut self, id: &str, secs: u64) -> AppResult<()> {
        if let Some(i) = self.items.iter_mut().find(|i| i.id == id) { i.playtime_secs = i.playtime_secs.saturating_add(secs); }
        self.save()
    }

    pub fn set_favorite(&mut self, id: &str, favorite: bool) -> AppResult<Instance> {
        let i = self.items.iter_mut().find(|i| i.id == id).ok_or_else(|| AppError::NotFound(format!("instance {id}")))?;
        i.favorite = favorite;
        let out = i.clone();
        self.save()?;
        Ok(out)
    }

    fn draft_of(i: &Instance, name: String) -> InstanceDraft {
        InstanceDraft {
            name, version_id: i.version_id.clone(), loader: i.loader, loader_version: i.loader_version.clone(),
            max_memory_mb: i.max_memory_mb, java_path: i.java_path.clone(), jvm_args: i.jvm_args.clone(),
            resolution: i.resolution, fullscreen: i.fullscreen, star_mod_enabled: i.star_mod_enabled,
        }
    }

    /// Independent copy: new id, copied files, reset statistics.
    /// `suffix` is the UI-localized copy marker (for example "(copy)"); it is trimmed and capped.
    pub fn duplicate(&mut self, id: &str, suffix: &str) -> AppResult<Instance> {
        let src = self.get(id)?.clone();
        let base: String = src.name.chars().take(40).collect();
        let suffix: String = suffix.trim().chars().take(7).collect();
        let suffix = if suffix.is_empty() { "(copy)".to_string() } else { suffix };
        let copy = self.create(Self::draft_of(&src, format!("{base} {suffix}")))?;
        copy_dir(&self.game_dir(id)?, &self.game_dir(&copy.id)?)?;
        Ok(copy)
    }

    /// Writes `<out_dir>/<name>-<ts>.zip` with `star-instance.json` plus the instance files under `files/`.
    pub fn export(&self, id: &str, out_dir: &Path) -> AppResult<PathBuf> {
        use std::io::Write;
        let inst = self.get(id)?.clone();
        std::fs::create_dir_all(out_dir)?;
        let safe: String = inst.name.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
        let out = out_dir.join(format!("{safe}-{}.zip", chrono::Local::now().format("%Y%m%d-%H%M%S")));
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&out)?);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let manifest = serde_json::json!({ "format": "star-instance", "version": 1, "instance": Self::manifest_draft(&inst) });
        zip.start_file("star-instance.json", opts)?;
        zip.write_all(&serde_json::to_vec_pretty(&manifest)?)?;
        let root = self.game_dir(id)?;
        let mut stack = vec![root.clone()];
        while let Some(dir) = stack.pop() {
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            for e in rd.flatten() {
                let p = e.path();
                let rel = p.strip_prefix(&root).map_err(|_| AppError::InvalidData("export path".into()))?;
                let name = format!("files/{}", rel.to_string_lossy().replace('\\', "/"));
                if p.is_dir() { zip.add_directory(format!("{name}/"), opts)?; stack.push(p); }
                else if p.is_file() {
                    zip.start_file(name, opts)?;
                    let mut f = std::fs::File::open(&p)?;
                    std::io::copy(&mut f, &mut zip)?;
                }
            }
        }
        zip.finish()?;
        Ok(out)
    }

    fn manifest_draft(i: &Instance) -> serde_json::Value {
        serde_json::json!({
            "name": i.name, "versionId": i.version_id, "loader": i.loader, "loaderVersion": i.loader_version,
            "maxMemoryMb": i.max_memory_mb, "javaPath": serde_json::Value::Null, "jvmArgs": i.jvm_args,
            "resolution": i.resolution, "fullscreen": i.fullscreen, "starModEnabled": i.star_mod_enabled,
        })
    }

    /// Imports a Star Client export. Every archive path is checked against zip-slip.
    pub fn import(&mut self, archive: &Path) -> AppResult<Instance> {
        use std::io::Read;
        let mut zip = zip::ZipArchive::new(std::fs::File::open(archive)?)?;
        let manifest: serde_json::Value = {
            let mut f = zip.by_name("star-instance.json").map_err(|_| AppError::Validation("not a Star Client export (star-instance.json is missing)".into()))?;
            if f.size() > 1024 * 1024 { return Err(AppError::Validation("manifest too large".into())); }
            let mut s = String::new(); f.read_to_string(&mut s)?;
            serde_json::from_str(&s)?
        };
        if manifest["format"] != "star-instance" { return Err(AppError::Validation("unknown instance archive format".into())); }
        let draft: InstanceDraft = serde_json::from_value(manifest["instance"].clone())?;
        let inst = self.create(draft)?;
        let dest = self.game_dir(&inst.id)?;
        for idx in 0..zip.len() {
            let mut entry = zip.by_index(idx)?;
            let Some(rel) = entry.enclosed_name() else { continue };
            let Ok(rel) = rel.strip_prefix("files") else { continue };
            if rel.as_os_str().is_empty() { continue; }
            let out = dest.join(rel);
            if entry.is_dir() { std::fs::create_dir_all(&out)?; continue; }
            if let Some(parent) = out.parent() { std::fs::create_dir_all(parent)?; }
            let mut f = std::fs::File::create(&out)?;
            std::io::copy(&mut entry, &mut f)?;
        }
        Ok(inst)
    }

    /// Remove from the registry. `confirm_name` must match exactly. When `delete_files`
    /// is set, the folder is *moved* to the launcher trash (recoverable), never erased.
    pub fn delete(&mut self, id: &str, confirm_name: &str, delete_files: bool, trash: &Path) -> AppResult<Option<PathBuf>> {
        let inst = self.get(id)?.clone();
        if inst.name != confirm_name {
            return Err(AppError::Validation("confirmation name does not match".into()));
        }
        let mut moved = None;
        if delete_files {
            let dir = self.game_dir(id)?;
            if dir.exists() {
                std::fs::create_dir_all(trash)?;
                let dest = trash.join(format!("{}-{}", inst.id, chrono::Utc::now().timestamp()));
                std::fs::rename(&dir, &dest)?;
                moved = Some(dest);
            }
        }
        self.items.retain(|i| i.id != id);
        self.save()?;
        Ok(moved)
    }
}

fn copy_dir(from: &Path, to: &Path) -> AppResult<()> {
    std::fs::create_dir_all(to)?;
    let Ok(rd) = std::fs::read_dir(from) else { return Ok(()) };
    for e in rd.flatten() {
        let (src, dst) = (e.path(), to.join(e.file_name()));
        let ft = e.file_type()?;
        if ft.is_dir() { copy_dir(&src, &dst)?; } else if ft.is_file() { std::fs::copy(&src, &dst)?; }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stats_favorite_duplicate_export_import() {
        let t = tempfile::tempdir().unwrap();
        let mut s = InstanceStore::load(&t.path().join("cfg"), &t.path().join("inst"));
        let a = s.create(draft("Main")).unwrap();
        std::fs::write(s.game_dir(&a.id).unwrap().join("saves/w.dat"), "w").unwrap();
        s.touch_played(&a.id).unwrap();
        s.record_playtime(&a.id, 90).unwrap();
        assert_eq!(s.get(&a.id).unwrap().play_count, 1);
        assert_eq!(s.get(&a.id).unwrap().playtime_secs, 90);
        assert!(s.set_favorite(&a.id, true).unwrap().favorite);
        let c = s.duplicate(&a.id, "(copy)").unwrap();
        assert_eq!(c.name, "Main (copy)");
        assert_eq!(c.play_count, 0);
        assert!(s.game_dir(&c.id).unwrap().join("saves/w.dat").exists());
        let zip = s.export(&a.id, &t.path().join("exports")).unwrap();
        let b = s.import(&zip).unwrap();
        assert_eq!(b.version_id, a.version_id);
        assert!(s.game_dir(&b.id).unwrap().join("saves/w.dat").exists());
    }

    fn draft(name: &str) -> InstanceDraft {
        InstanceDraft { name: name.into(), version_id: "1.21.1".into(), loader: LoaderKind::Vanilla, loader_version: None,
            max_memory_mb: Some(2048), java_path: None, jvm_args: vec![], resolution: None, fullscreen: None, star_mod_enabled: false }
    }

    #[test]
    fn create_persist_delete() {
        let t = tempfile::tempdir().unwrap();
        let (cfg, inst, trash) = (t.path().join("cfg"), t.path().join("inst"), t.path().join("trash"));
        let mut s = InstanceStore::load(&cfg, &inst);
        let a = s.create(draft("Survival")).unwrap();
        let dir = s.game_dir(&a.id).unwrap();
        std::fs::write(dir.join("saves/world.dat"), "w").unwrap();
        let s2 = InstanceStore::load(&cfg, &inst);
        assert_eq!(s2.list().len(), 1);
        let mut s = s2;
        assert!(s.delete(&a.id, "wrong", true, &trash).is_err(), "requires exact confirmation");
        let moved = s.delete(&a.id, "Survival", true, &trash).unwrap().unwrap();
        assert!(moved.join("saves/world.dat").exists(), "files moved to trash, not deleted");
        assert!(InstanceStore::load(&cfg, &inst).list().is_empty());
    }

    #[test]
    fn delete_keeps_files_by_default() {
        let t = tempfile::tempdir().unwrap();
        let mut s = InstanceStore::load(t.path(), &t.path().join("i"));
        let a = s.create(draft("Keep")).unwrap();
        let dir = s.game_dir(&a.id).unwrap();
        assert!(s.delete(&a.id, "Keep", false, &t.path().join("trash")).unwrap().is_none());
        assert!(dir.exists());
    }

    #[test]
    fn validation() {
        assert!(draft("").validate().is_err());
        let mut d = draft("x"); d.loader = LoaderKind::Fabric; assert!(d.validate().is_err());
        d.loader_version = Some("0.16.5".into()); assert!(d.validate().is_ok());
        let mut d = draft("x"); d.star_mod_enabled = true; assert!(d.validate().is_err());
        let mut d = draft("x"); d.version_id = "../1".into(); assert!(d.validate().is_err());
    }
}
