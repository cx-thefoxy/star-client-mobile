//! Mod loader metadata from official project endpoints.
//! Fabric: https://meta.fabricmc.net/v2  ·  Quilt: https://meta.quiltmc.org/v3
//! Forge / NeoForge: maven-metadata.xml for listing; installation runs the official installer (see `forge`).
pub mod forge;

use crate::downloads::Downloader;
use crate::error::{AppError, AppResult};
use crate::instances::LoaderKind;
use crate::minecraft::version_json::VersionJson;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoaderVersion { pub version: String, pub stable: bool }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoaderCompat {
    pub loader: LoaderKind,
    pub game_version: String,
    pub compatible: bool,
    pub installable: bool,
    pub versions: Vec<LoaderVersion>,
    pub reason: Option<String>,
}

#[derive(Deserialize)]
struct MetaLoaderEntry { loader: MetaLoader }
#[derive(Deserialize)]
struct MetaLoader { version: String, #[serde(default)] stable: Option<bool> }

fn meta_base(kind: LoaderKind) -> Option<&'static str> {
    match kind {
        LoaderKind::Fabric => Some("https://meta.fabricmc.net/v2"),
        LoaderKind::Quilt => Some("https://meta.quiltmc.org/v3"),
        _ => None,
    }
}

pub async fn compat(dl: &Downloader, kind: LoaderKind, game: &str) -> AppResult<LoaderCompat> {
    crate::paths::validate_id(game)?;
    let mut out = LoaderCompat { loader: kind, game_version: game.into(), compatible: false, installable: false, versions: vec![], reason: None };
    match kind {
        LoaderKind::Vanilla => { out.compatible = true; out.installable = true; }
        LoaderKind::Fabric | LoaderKind::Quilt => {
            let url = format!("{}/versions/loader/{}", meta_base(kind).unwrap(), urlencode(game));
            match dl.get_json::<Vec<MetaLoaderEntry>>(&url).await {
                Ok(list) if !list.is_empty() => {
                    out.versions = list.into_iter().map(|e| LoaderVersion {
                        stable: e.loader.stable.unwrap_or(!e.loader.version.contains('-')),
                        version: e.loader.version,
                    }).collect();
                    out.compatible = true;
                    out.installable = true;
                }
                Ok(_) | Err(AppError::NotFound(_)) | Err(AppError::Network(_)) => {
                    out.reason = Some(format!("{kind:?} does not publish a loader for Minecraft {game}"));
                }
                Err(e) => return Err(e),
            }
        }
        LoaderKind::Forge | LoaderKind::NeoForge => {
            if kind == LoaderKind::Forge && !forge_supported(game) {
                out.reason = Some(format!("Forge installation supports Minecraft 1.7.10 and newer, not {game}"));
                return Ok(out);
            }
            let versions = maven_versions(dl, kind, game).await?;
            out.versions = versions.into_iter().filter(|v| forge_like_matches(kind, v, game))
                .map(|v| LoaderVersion { stable: !(v.contains("beta") || v.contains("alpha")), version: v }).rev().collect();
            out.compatible = !out.versions.is_empty();
            out.installable = out.compatible;
            if !out.compatible { out.reason = Some(format!("No {kind:?} build for Minecraft {game}")); }
        }
    }
    Ok(out)
}

fn urlencode(s: &str) -> String {
    s.chars().map(|c| if c.is_ascii_alphanumeric() || "-._~".contains(c) { c.to_string() } else { format!("%{:02X}", c as u32) }).collect()
}

async fn maven_versions(dl: &Downloader, kind: LoaderKind, game: &str) -> AppResult<Vec<String>> {
    let xml = dl.get_text(metadata_url(kind, game)).await?;
    Ok(parse_maven_versions(&xml))
}

/// NeoForge for 1.20.1 is published under the legacy `net.neoforged:forge` artifact.
fn neo_legacy(kind: LoaderKind, game: &str) -> bool { kind == LoaderKind::NeoForge && game == "1.20.1" }

fn metadata_url(kind: LoaderKind, game: &str) -> &'static str {
    match kind {
        LoaderKind::Forge => "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml",
        _ if neo_legacy(kind, game) => "https://maven.neoforged.net/releases/net/neoforged/forge/maven-metadata.xml",
        _ => "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
    }
}

/// Official installer jar for a Forge/NeoForge build.
pub fn installer_url(kind: LoaderKind, game: &str, v: &str) -> String {
    match kind {
        LoaderKind::Forge => format!("https://maven.minecraftforge.net/net/minecraftforge/forge/{v}/forge-{v}-installer.jar"),
        _ if neo_legacy(kind, game) => format!("https://maven.neoforged.net/releases/net/neoforged/forge/{v}/forge-{v}-installer.jar"),
        _ => format!("https://maven.neoforged.net/releases/net/neoforged/neoforge/{v}/neoforge-{v}-installer.jar"),
    }
}

/// Forge installers are only handled for 1.7.10 and newer (older ones have no headless installer).
fn forge_supported(game: &str) -> bool {
    let mut it = game.split('.').map(|p| p.parse::<u32>());
    match (it.next(), it.next(), it.next()) {
        (Some(Ok(a)), Some(Ok(b)), c) => {
            let c = match c { Some(Ok(c)) => c, _ => 0 };
            (a, b, c) >= (1, 7, 10)
        }
        _ => false,
    }
}

pub fn parse_maven_versions(xml: &str) -> Vec<String> {
    xml.split("<version>").skip(1).filter_map(|s| s.split("</version>").next()).map(|s| s.trim().to_string()).collect()
}

/// Forge: `1.20.1-47.2.0`. NeoForge: `21.1.77` ↔ MC `1.21.1`, `20.4.237` ↔ `1.20.4`, `21.0.x` ↔ `1.21`.
pub fn forge_like_matches(kind: LoaderKind, v: &str, game: &str) -> bool {
    match kind {
        LoaderKind::Forge => v.split_once('-').map_or(false, |(mc, _)| mc == game),
        LoaderKind::NeoForge => {
            if game == "1.20.1" { return v.split_once('-').map_or(false, |(mc, _)| mc == game); }
            let p: Vec<&str> = v.split('.').collect();
            if p.len() < 3 { return false; }
            let first: u32 = match p[0].parse() { Ok(n) => n, Err(_) => return false };
            let mc = if first >= 26 {
                // Calendar versions: `26.1.0.10-beta` ↔ Minecraft `26.1`, `26.1.1.3` ↔ `26.1.1`.
                if p.len() < 4 { return false; }
                if p[2] == "0" { format!("{}.{}", p[0], p[1]) } else { format!("{}.{}.{}", p[0], p[1], p[2]) }
            } else if p[1] == "0" { format!("1.{}", p[0]) } else { format!("1.{}.{}", p[0], p[1]) };
            mc == game
        }
        _ => false,
    }
}

/// Fetch the launcher profile JSON for Fabric/Quilt. Returns `(profile_id, json)`.
pub async fn fetch_profile(dl: &Downloader, kind: LoaderKind, game: &str, loader: &str) -> AppResult<(String, VersionJson)> {
    let base = meta_base(kind).ok_or_else(|| AppError::Unsupported(format!("{kind:?} profiles")))?;
    crate::paths::validate_id(loader)?;
    let url = format!("{base}/versions/loader/{}/{}/profile/json", urlencode(game), urlencode(loader));
    let profile: VersionJson = dl.get_json(&url).await.map_err(|e| match e {
        AppError::NotFound(_) => AppError::Unsupported(format!("{kind:?} {loader} is not available for Minecraft {game}")),
        e => e,
    })?;
    if profile.inherits_from.as_deref() != Some(game) {
        return Err(AppError::InvalidData(format!("loader profile inherits from {:?}, expected {game}", profile.inherits_from)));
    }
    crate::paths::validate_id(&profile.id)?;
    for lib in &profile.libraries {
        if let Some(u) = &lib.url { crate::downloads::ensure_trusted_url(u)?; }
    }
    Ok((profile.id.clone(), profile))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neoforge_mapping() {
        assert!(forge_like_matches(LoaderKind::NeoForge, "21.1.77", "1.21.1"));
        assert!(forge_like_matches(LoaderKind::NeoForge, "21.0.167", "1.21"));
        assert!(forge_like_matches(LoaderKind::NeoForge, "20.4.237", "1.20.4"));
        assert!(!forge_like_matches(LoaderKind::NeoForge, "20.4.237", "1.21.1"));
    }

    #[test]
    fn neoforge_new_schemes() {
        assert!(forge_like_matches(LoaderKind::NeoForge, "26.1.0.10-beta", "26.1"));
        assert!(forge_like_matches(LoaderKind::NeoForge, "26.1.1.3", "26.1.1"));
        assert!(!forge_like_matches(LoaderKind::NeoForge, "26.1.1.3", "26.1"));
        assert!(forge_like_matches(LoaderKind::NeoForge, "1.20.1-47.1.106", "1.20.1"));
        assert!(forge_like_matches(LoaderKind::NeoForge, "21.11.5", "1.21.11"));
    }

    #[test]
    fn forge_support_floor() {
        assert!(forge_supported("1.7.10"));
        assert!(forge_supported("1.21.1"));
        assert!(forge_supported("26.1"));
        assert!(!forge_supported("1.7.2"));
        assert!(!forge_supported("b1.7.3"));
    }

    #[test]
    fn installer_urls() {
        assert_eq!(installer_url(LoaderKind::Forge, "1.20.1", "1.20.1-47.2.0"),
            "https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.2.0/forge-1.20.1-47.2.0-installer.jar");
        assert_eq!(installer_url(LoaderKind::NeoForge, "1.21.1", "21.1.77"),
            "https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.77/neoforge-21.1.77-installer.jar");
        assert!(installer_url(LoaderKind::NeoForge, "1.20.1", "1.20.1-47.1.106").contains("/net/neoforged/forge/"));
    }

    #[test]
    fn forge_mapping() {
        assert!(forge_like_matches(LoaderKind::Forge, "1.20.1-47.2.0", "1.20.1"));
        assert!(!forge_like_matches(LoaderKind::Forge, "1.20.1-47.2.0", "1.20"));
    }

    #[test]
    fn maven_xml() {
        let xml = "<metadata><versioning><versions><version>1.0</version><version> 2.0 </version></versions></versioning></metadata>";
        assert_eq!(parse_maven_versions(xml), vec!["1.0", "2.0"]);
    }

    #[test]
    fn encodes_spaces() { assert_eq!(urlencode("1.14 Pre-Release 1"), "1.14%20Pre-Release%201"); }
}
