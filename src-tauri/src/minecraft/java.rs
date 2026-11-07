//! Java runtime selection. Android ships Java 8, 17 and 21 inside the APK (see `android.rs`); nothing is downloaded or executed
//! to probe them (Android blocks exec from app data), so versions are read from each runtime's `release` file.
use crate::error::AppResult;
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JavaInstall {
    pub path: String,
    pub version: String,
    pub major: u32,
    pub arch: String,
    pub managed: bool,
}

/// "1.8.0_402" -> 8, "17.0.10" -> 17, "21" -> 21, "22-ea" -> 22
pub fn parse_major(version: &str) -> Option<u32> {
    let v = version.trim().trim_matches('"');
    let mut parts = v.split(|c: char| c == '.' || c == '_' || c == '-' || c == '+');
    let first: u32 = parts.next()?.parse().ok()?;
    if first == 1 { parts.next()?.parse().ok() } else { Some(first) }
}

/// Parse `java -XshowSettings:properties -version` stderr output.
pub fn parse_properties(out: &str) -> Option<(String, String)> {
    let mut version = None;
    let mut arch = String::new();
    for line in out.lines() {
        let l = line.trim();
        if let Some(v) = l.strip_prefix("java.version = ") { version = Some(v.to_string()); }
        if let Some(a) = l.strip_prefix("os.arch = ") { arch = a.to_string(); }
    }
    version.map(|v| (v, arch))
}

/// Minecraft <=1.16 (Java 8 requirement) is unreliable on newer runtimes because of LaunchWrapper
/// and old LWJGL; require 8 exactly. Otherwise use the lowest major >= required.
pub fn is_compatible(install_major: u32, required: u32) -> bool {
    if required <= 8 { install_major == 8 } else { install_major >= required }
}

pub fn select<'a>(installs: &'a [JavaInstall], required: u32) -> Option<&'a JavaInstall> {
    installs.iter()
        .filter(|j| is_compatible(j.major, required) && is_64bit_arch(&j.arch))
        .min_by_key(|j| (j.major, !j.managed))
}

fn is_64bit_arch(a: &str) -> bool { a.is_empty() || matches!(a, "amd64" | "x86_64" | "aarch64" | "arm64") }

/// `JAVA_VERSION="21.0.1"` from the runtime's `release` file.
fn release_version(jre: &Path) -> Option<String> {
    std::fs::read_to_string(jre.join("release")).ok()?.lines()
        .find_map(|l| l.strip_prefix("JAVA_VERSION=").map(|v| v.trim().trim_matches('"').to_string()))
}

/// The three bundled runtimes. `version` is the real one once unpacked, otherwise the bundled major with "(not unpacked yet)".
pub async fn detect(runtimes: &Path) -> Vec<JavaInstall> {
    crate::android::BUNDLED.iter().map(|&m| {
        let dir = crate::android::jre_dir(runtimes, m);
        let ready = crate::android::jre_valid(&dir);
        let version = if ready { release_version(&dir).unwrap_or_else(|| m.to_string()) } else { format!("{m} (not unpacked yet)") };
        JavaInstall { path: dir.join("bin/java").display().to_string(), version, major: m, arch: "aarch64".into(), managed: true }
    }).collect()
}

/// Picks the bundled runtime for `required`, unpacks it on first use and returns its directory.
pub async fn resolve_bundled(runtimes: &Path, required: u32) -> AppResult<std::path::PathBuf> {
    crate::android::ensure_runtime(runtimes, crate::android::bundled_major(required)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn majors() {
        assert_eq!(parse_major("1.8.0_402"), Some(8));
        assert_eq!(parse_major("17.0.10"), Some(17));
        assert_eq!(parse_major("21"), Some(21));
        assert_eq!(parse_major("22-ea"), Some(22));
        assert_eq!(parse_major("garbage"), None);
    }

    #[test]
    fn properties() {
        let out = "Property settings:\n    java.version = 21.0.4\n    os.arch = amd64\nopenjdk version \"21.0.4\"";
        assert_eq!(parse_properties(out), Some(("21.0.4".into(), "amd64".into())));
    }

    fn j(major: u32, managed: bool) -> JavaInstall {
        JavaInstall { path: format!("j{major}{managed}"), version: major.to_string(), major, arch: "amd64".into(), managed }
    }

    #[test]
    fn selection() {
        let all = vec![j(8, false), j(17, false), j(21, false), j(21, true)];
        assert_eq!(select(&all, 8).unwrap().major, 8);
        assert_eq!(select(&all, 16).unwrap().major, 17);
        assert_eq!(select(&all, 17).unwrap().major, 17);
        let s = select(&all, 21).unwrap();
        assert!(s.major == 21 && s.managed, "prefers managed runtime on tie");
        assert!(select(&all, 25).is_none());
        assert!(select(&[j(17, false)], 8).is_none(), "Java 8 versions need Java 8");
    }
}
