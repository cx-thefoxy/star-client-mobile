//! Read-only inspection of an instance's `mods` folder plus safe enable/disable/remove.
use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModInfo {
    pub file_name: String,
    pub enabled: bool,
    pub size: u64,
    pub id: Option<String>,
    pub name: Option<String>,
    pub version: Option<String>,
    pub loader: Option<String>,
    pub depends: Vec<String>,
    pub problems: Vec<String>,
}

const IGNORED_DEPS: &[&str] = &["minecraft", "java", "fabricloader", "quilt_loader", "forge", "neoforge", "fabric"];

fn read_entry(zip: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Option<String> {
    let mut f = zip.by_name(name).ok()?;
    if f.size() > 1024 * 1024 { return None; }
    let mut s = String::new();
    f.read_to_string(&mut s).ok()?;
    Some(s)
}

/// Very small TOML reader for the first `[[mods]]` block of mods.toml (avoids executing anything).
fn toml_value(src: &str, key: &str) -> Option<String> {
    let block = src.split("[[mods]]").nth(1)?;
    for line in block.lines() {
        let l = line.trim();
        if l.starts_with("[[") { break; }
        if let Some(rest) = l.strip_prefix(key) {
            let rest = rest.trim_start();
            if let Some(v) = rest.strip_prefix('=') {
                return Some(v.trim().trim_matches('"').to_string());
            }
        }
    }
    None
}

pub fn inspect(path: &Path) -> ModInfo {
    let file_name = path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let mut info = ModInfo {
        enabled: !file_name.ends_with(".disabled"),
        size: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
        file_name, id: None, name: None, version: None, loader: None, depends: vec![], problems: vec![],
    };
    let mut zip = match std::fs::File::open(path).map_err(AppError::from).and_then(|f| Ok(zip::ZipArchive::new(f)?)) {
        Ok(z) => z,
        Err(_) => { info.problems.push("not_a_valid_jar".into()); return info; }
    };
    if let Some(j) = read_entry(&mut zip, "fabric.mod.json") {
        match serde_json::from_str::<serde_json::Value>(&j) {
            Ok(v) => {
                info.loader = Some("fabric".into());
                info.id = v["id"].as_str().map(String::from);
                info.name = v["name"].as_str().map(String::from).or(info.id.clone());
                info.version = v["version"].as_str().map(String::from);
                if let Some(d) = v["depends"].as_object() { info.depends = d.keys().cloned().collect(); }
            }
            Err(_) => info.problems.push("invalid_metadata".into()),
        }
    } else if let Some(j) = read_entry(&mut zip, "quilt.mod.json") {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&j) {
            info.loader = Some("quilt".into());
            let l = &v["quilt_loader"];
            info.id = l["id"].as_str().map(String::from);
            info.version = l["version"].as_str().map(String::from);
            info.name = l["metadata"]["name"].as_str().map(String::from).or(info.id.clone());
            if let Some(d) = l["depends"].as_array() {
                info.depends = d.iter().filter_map(|x| x.as_str().map(String::from).or_else(|| x["id"].as_str().map(String::from))).collect();
            }
        }
    } else if let Some(t) = read_entry(&mut zip, "META-INF/neoforge.mods.toml") {
        info.loader = Some("neoforge".into());
        info.id = toml_value(&t, "modId"); info.name = toml_value(&t, "displayName"); info.version = toml_value(&t, "version");
    } else if let Some(t) = read_entry(&mut zip, "META-INF/mods.toml") {
        info.loader = Some("forge".into());
        info.id = toml_value(&t, "modId"); info.name = toml_value(&t, "displayName"); info.version = toml_value(&t, "version");
    } else if let Some(j) = read_entry(&mut zip, "mcmod.info") {
        // Legacy Forge (1.7.10–1.12.2): a JSON array, or an object with `modList`.
        info.loader = Some("forge".into());
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&j) {
            let first = v.as_array().and_then(|a| a.first()).or_else(|| v["modList"].as_array().and_then(|a| a.first()));
            if let Some(m) = first {
                info.id = m["modid"].as_str().map(String::from);
                info.name = m["name"].as_str().map(String::from).or(info.id.clone());
                info.version = m["version"].as_str().map(String::from);
            }
        }
    } else {
        info.problems.push("no_mod_metadata".into());
    }
    info
}

pub fn list(mods_dir: &Path, instance_loader: &str) -> AppResult<Vec<ModInfo>> {
    let mut out = Vec::new();
    let rd = match std::fs::read_dir(mods_dir) { Ok(r) => r, Err(_) => return Ok(out) };
    for e in rd.flatten() {
        let n = e.file_name().to_string_lossy().into_owned();
        if e.path().is_file() && (n.ends_with(".jar") || n.ends_with(".jar.disabled")) {
            out.push(inspect(&e.path()));
        }
    }
    diagnose(&mut out, instance_loader);
    out.sort_by(|a, b| a.name.clone().unwrap_or_default().to_lowercase().cmp(&b.name.clone().unwrap_or_default().to_lowercase()));
    Ok(out)
}

pub fn diagnose(mods: &mut [ModInfo], instance_loader: &str) {
    let ids: HashSet<String> = mods.iter().filter(|m| m.enabled).filter_map(|m| m.id.clone()).collect();
    let has_fabric_api = ids.contains("fabric-api");
    let mut counts: HashMap<String, usize> = HashMap::new();
    for m in mods.iter().filter(|m| m.enabled) { if let Some(id) = &m.id { *counts.entry(id.clone()).or_default() += 1; } }
    for m in mods.iter_mut() {
        if let Some(l) = &m.loader {
            let ok = l == instance_loader || (instance_loader == "quilt" && l == "fabric");
            if !ok { m.problems.push(format!("wrong_loader:{l}")); }
        }
        if !m.enabled { continue; }
        if let Some(id) = &m.id { if counts.get(id).copied().unwrap_or(0) > 1 { m.problems.push("duplicate".into()); } }
        for d in &m.depends {
            if IGNORED_DEPS.contains(&d.as_str()) || ids.contains(d) { continue; }
            if d.starts_with("fabric-") && has_fabric_api { continue; }
            m.problems.push(format!("missing_dependency:{d}"));
        }
    }
}

fn resolve_in(mods_dir: &Path, file_name: &str) -> AppResult<PathBuf> {
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return Err(AppError::Validation("invalid mod file name".into()));
    }
    let p = mods_dir.join(file_name);
    if !p.is_file() { return Err(AppError::NotFound(file_name.into())); }
    Ok(p)
}

pub fn set_enabled(mods_dir: &Path, file_name: &str, enabled: bool) -> AppResult<String> {
    let p = resolve_in(mods_dir, file_name)?;
    let new_name = match (enabled, file_name.strip_suffix(".disabled")) {
        (true, Some(base)) => base.to_string(),
        (false, None) => format!("{file_name}.disabled"),
        _ => return Ok(file_name.to_string()),
    };
    let dest = mods_dir.join(&new_name);
    if dest.exists() { return Err(AppError::Validation(format!("{new_name} already exists"))); }
    std::fs::rename(p, dest)?;
    Ok(new_name)
}

/// Moves the mod into `<instance>/.star-trash/` instead of deleting it.
pub fn remove(mods_dir: &Path, file_name: &str) -> AppResult<()> {
    let p = resolve_in(mods_dir, file_name)?;
    let trash = mods_dir.parent().unwrap_or(mods_dir).join(".star-trash");
    std::fs::create_dir_all(&trash)?;
    std::fs::rename(p, trash.join(format!("{}-{file_name}", chrono::Utc::now().timestamp())))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn jar(dir: &Path, name: &str, fmj: &str) {
        let mut z = zip::ZipWriter::new(std::fs::File::create(dir.join(name)).unwrap());
        z.start_file("fabric.mod.json", zip::write::SimpleFileOptions::default()).unwrap();
        z.write_all(fmj.as_bytes()).unwrap();
        z.finish().unwrap();
    }

    #[test]
    fn lists_and_diagnoses() {
        let t = tempfile::tempdir().unwrap();
        jar(t.path(), "a.jar", r#"{"id":"sodium","name":"Sodium","version":"0.6","depends":{"minecraft":"*","fabric-api":"*"}}"#);
        std::fs::write(t.path().join("junk.jar"), "not a zip").unwrap();
        let mods = list(t.path(), "fabric").unwrap();
        let s = mods.iter().find(|m| m.id.as_deref() == Some("sodium")).unwrap();
        assert!(s.problems.contains(&"missing_dependency:fabric-api".to_string()));
        assert!(mods.iter().any(|m| m.problems.contains(&"not_a_valid_jar".to_string())));
        let forge = list(t.path(), "forge").unwrap();
        assert!(forge.iter().any(|m| m.problems.contains(&"wrong_loader:fabric".to_string())));
    }

    #[test]
    fn toggle_and_remove() {
        let t = tempfile::tempdir().unwrap();
        let mods = t.path().join("mods");
        std::fs::create_dir_all(&mods).unwrap();
        jar(&mods, "a.jar", r#"{"id":"a"}"#);
        assert_eq!(set_enabled(&mods, "a.jar", false).unwrap(), "a.jar.disabled");
        assert_eq!(set_enabled(&mods, "a.jar.disabled", true).unwrap(), "a.jar");
        assert!(set_enabled(&mods, "../x.jar", true).is_err());
        remove(&mods, "a.jar").unwrap();
        assert!(!mods.join("a.jar").exists());
        assert_eq!(std::fs::read_dir(t.path().join(".star-trash")).unwrap().count(), 1);
    }

    #[test]
    fn toml() {
        let t = "modLoader=\"javafml\"\n[[mods]]\nmodId=\"jei\"\nversion=\"1.0\"\ndisplayName=\"JEI\"\n";
        assert_eq!(toml_value(t, "modId").as_deref(), Some("jei"));
        assert_eq!(toml_value(t, "displayName").as_deref(), Some("JEI"));
    }
}
