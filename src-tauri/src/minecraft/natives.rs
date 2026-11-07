//! Native library extraction for both legacy (`natives` map + classifiers) and modern
//! (`:natives-<os>` coordinates) layouts.
use super::rules::Environment;
use super::version_json::{Artifact, Library};
use crate::error::AppResult;
use std::io::Read;
use std::path::Path;

/// For legacy libraries, the classifier artifact for this OS, if any.
pub fn legacy_native_artifact<'a>(lib: &'a Library, env: &Environment) -> Option<&'a Artifact> {
    let natives = lib.natives.as_ref()?;
    let classifier = natives.get(&env.os_name)?.replace("${arch}", if env.is_64bit() { "64" } else { "32" });
    lib.downloads.as_ref()?.classifiers.as_ref()?.get(&classifier)
}

pub fn is_modern_native(lib: &Library) -> bool {
    lib.name.split(':').nth(3).map_or(false, |c| c.starts_with("natives-"))
}

/// Extract a natives jar, skipping META-INF and any `extract.exclude` prefixes.
/// Uses `enclosed_name` so archive entries can't escape the target directory.
pub fn extract(jar: &Path, target: &Path, exclude: &[String]) -> AppResult<usize> {
    std::fs::create_dir_all(target)?;
    let mut zip = zip::ZipArchive::new(std::fs::File::open(jar)?)?;
    let mut count = 0;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        if entry.is_dir() { continue; }
        let Some(rel) = entry.enclosed_name() else { continue };
        let rel_s = rel.to_string_lossy().replace('\\', "/");
        if rel_s.starts_with("META-INF/") || exclude.iter().any(|e| rel_s.starts_with(e.as_str())) { continue; }
        let lower = rel_s.to_ascii_lowercase();
        if !(lower.ends_with(".dll") || lower.ends_with(".so") || lower.ends_with(".dylib") || lower.ends_with(".jnilib")) { continue; }
        // Natives are loaded flat from java.library.path.
        let Some(fname) = rel.file_name() else { continue };
        let dest = target.join(fname);
        let mut buf = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut buf)?;
        std::fs::write(&dest, buf)?;
        count += 1;
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn extracts_only_natives_and_blocks_traversal() {
        let dir = tempfile::tempdir().unwrap();
        let jar = dir.path().join("n.jar");
        {
            let mut z = zip::ZipWriter::new(std::fs::File::create(&jar).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            z.start_file("lwjgl64.dll", o).unwrap(); z.write_all(b"x").unwrap();
            z.start_file("META-INF/MANIFEST.MF", o).unwrap(); z.write_all(b"m").unwrap();
            z.start_file("../../evil.dll", o).unwrap(); z.write_all(b"e").unwrap();
            z.start_file("readme.txt", o).unwrap(); z.write_all(b"r").unwrap();
            z.finish().unwrap();
        }
        let out = dir.path().join("natives");
        assert_eq!(extract(&jar, &out, &[]).unwrap(), 1);
        assert!(out.join("lwjgl64.dll").exists());
        assert!(!dir.path().join("evil.dll").exists());
    }

    #[test]
    fn modern_native_detection() {
        let l: Library = serde_json::from_value(serde_json::json!({ "name": "org.lwjgl:lwjgl:3.3.3:natives-windows" })).unwrap();
        assert!(is_modern_native(&l));
        let l: Library = serde_json::from_value(serde_json::json!({ "name": "org.lwjgl:lwjgl:3.3.3" })).unwrap();
        assert!(!is_modern_native(&l));
    }
}
