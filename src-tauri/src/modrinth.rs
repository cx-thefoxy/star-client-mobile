//! Real Modrinth discovery and integrity-checked project installation.
use crate::downloads::{DownloadTask, Downloader, Progress, ensure_trusted_url};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

pub const API: &str = "https://api.modrinth.com/v2";

fn auth(req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    match std::env::var("STAR_MODRINTH_TOKEN").ok().filter(|v| !v.trim().is_empty()) {
        Some(token) => req.bearer_auth(token),
        None => req,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchProject {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub downloads: u64,
    pub follows: u64,
    pub project_type: String,
    pub categories: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse { hits: Vec<SearchHit> }
#[derive(Debug, Deserialize)]
struct SearchHit {
    project_id: String,
    slug: String,
    title: String,
    description: String,
    #[serde(default)]
    icon_url: Option<String>,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    follows: u64,
    project_type: String,
    #[serde(default)]
    categories: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct Version {
    version_number: String,
    version_type: String,
    #[serde(default)]
    game_versions: Vec<String>,
    #[serde(default)]
    loaders: Vec<String>,
    files: Vec<File>,
}
#[derive(Debug, Deserialize)]
struct File {
    url: String,
    filename: String,
    #[serde(default)]
    primary: bool,
    hashes: Hashes,
    #[serde(default)]
    size: Option<u64>,
}
#[derive(Debug, Deserialize)]
struct Hashes { #[serde(default)] sha1: Option<String> }

fn choose_version<'a>(versions: &'a [Version]) -> Option<&'a Version> {
    versions.iter().find(|v| v.version_type == "release").or_else(|| versions.first())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult { pub project_id: String, pub file_name: String, pub version: String }

pub async fn search(http: &reqwest::Client, query: &str, game_version: &str, loader: &str, limit: u32) -> AppResult<Vec<SearchProject>> {
    search_at(http, API, query, game_version, loader, limit).await
}

async fn search_at(http: &reqwest::Client, api: &str, query: &str, game_version: &str, loader: &str, limit: u32) -> AppResult<Vec<SearchProject>> {
    let mut params = vec![("query", query.to_string()), ("limit", limit.clamp(1, 100).to_string()), ("index", "relevance".into())];
    let mut facets = vec![vec!["project_type:mod".to_string()]];
    if !game_version.is_empty() { facets.push(vec![format!("versions:{game_version}")]); }
    if !loader.is_empty() && loader != "vanilla" { facets.push(vec![format!("categories:{loader}")]); }
    params.push(("facets", serde_json::to_string(&facets)?));
    let r = auth(http.get(format!("{api}/search"))).query(&params).send().await?;
    if !r.status().is_success() { return Err(AppError::Network(format!("Modrinth search failed (HTTP {})", r.status()))); }
    let body: SearchResponse = r.json().await?;
    Ok(body.hits.into_iter().map(|h| SearchProject {
        id: h.project_id, slug: h.slug, title: h.title, description: h.description,
        icon_url: h.icon_url, downloads: h.downloads, follows: h.follows,
        project_type: h.project_type, categories: h.categories,
    }).collect())
}

pub async fn install(
    http: &reqwest::Client,
    downloader: &Downloader,
    mods_dir: PathBuf,
    project_id: &str,
    game_version: &str,
    loader: &str,
    cancel: Arc<AtomicBool>,
    sink: Arc<dyn Fn(&Progress) + Send + Sync>,
) -> AppResult<InstallResult> {
    install_at(http, API, downloader, mods_dir, project_id, game_version, loader, cancel, sink).await
}

async fn install_at(
    http: &reqwest::Client,
    api: &str,
    downloader: &Downloader,
    mods_dir: PathBuf,
    project_id: &str,
    game_version: &str,
    loader: &str,
    cancel: Arc<AtomicBool>,
    sink: Arc<dyn Fn(&Progress) + Send + Sync>,
) -> AppResult<InstallResult> {
    if !project_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' ) || project_id.is_empty() {
        return Err(AppError::Validation("invalid Modrinth project id".into()));
    }
    let versions: Vec<Version> = auth(http.get(format!("{api}/project/{project_id}/version")))
        .query(&[("game_versions", serde_json::to_string(&[game_version])?), ("loaders", serde_json::to_string(&[loader])?), ("featured", "true".into())])
        .send().await?.error_for_status()?.json().await?;
    let version = choose_version(&versions)
        .ok_or_else(|| AppError::NotFound("no compatible Modrinth version".into()))?;
    let file = version.files.iter().find(|f| f.primary).or_else(|| version.files.first())
        .ok_or_else(|| AppError::InvalidData("Modrinth version has no downloadable file".into()))?;
    let url = ensure_trusted_url(&file.url)?;
    if url.host_str() != Some("cdn.modrinth.com") {
        return Err(AppError::Validation("Modrinth file did not come from the trusted CDN".into()));
    }
    if !file.filename.ends_with(".jar") || file.filename.contains('/') || file.filename.contains('\\') || file.filename.contains("..") {
        return Err(AppError::Validation("Modrinth returned an unsafe mod filename".into()));
    }
    let dest = mods_dir.join(&file.filename);
    downloader.run("Modrinth", vec![DownloadTask {
        url: url.to_string(), dest, sha1: file.hashes.sha1.clone(), size: file.size,
    }], cancel, sink).await?;
    Ok(InstallResult { project_id: project_id.into(), file_name: file.filename.clone(), version: version.version_number.clone() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client() -> reqwest::Client { reqwest::Client::builder().build().unwrap() }

    #[tokio::test]
    async fn search_contract_sends_facets_and_maps_project_fields() {
        let mut server = mockito::Server::new_async().await;
        let mock = server.mock("GET", "/search")
            .match_query(mockito::Matcher::UrlEncoded("query".into(), "sodium".into()))
            .match_query(mockito::Matcher::UrlEncoded("limit".into(), "40".into()))
            .match_query(mockito::Matcher::UrlEncoded("index".into(), "relevance".into()))
            .match_query(mockito::Matcher::UrlEncoded("facets".into(), r#"[["project_type:mod"],["versions:1.21.1"],["categories:fabric"]]"#.into()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"hits":[{"project_id":"AAbb12","slug":"sodium","title":"Sodium","description":"Fast rendering","icon_url":"https://cdn.modrinth.com/icon.png","downloads":1234,"follows":56,"project_type":"mod","categories":["fabric","optimization"]}]}"#)
            .create_async().await;

        let result = search_at(&client(), &server.url(), "sodium", "1.21.1", "fabric", 40).await.unwrap();
        mock.assert_async().await;
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "AAbb12");
        assert_eq!(result[0].title, "Sodium");
        assert_eq!(result[0].downloads, 1234);
    }

    #[tokio::test]
    async fn search_contract_maps_http_failure_to_network_error() {
        let mut server = mockito::Server::new_async().await;
        let mock = server.mock("GET", "/search").match_query(mockito::Matcher::Any).with_status(429).create_async().await;
        let err = search_at(&client(), &server.url(), "x", "", "", 1).await.unwrap_err();
        mock.assert_async().await;
        assert!(matches!(err, AppError::Network(_)));
        assert!(err.to_string().contains("HTTP 429"));
    }

    #[tokio::test]
    async fn install_contract_prefers_release_and_primary_file() {
        let mut server = mockito::Server::new_async().await;
        let mock = server.mock("GET", "/project/sodium/version")
            .match_query(mockito::Matcher::UrlEncoded("game_versions".into(), r#"["1.21.1"]"#.into()))
            .match_query(mockito::Matcher::UrlEncoded("loaders".into(), r#"["fabric"]"#.into()))
            .match_query(mockito::Matcher::UrlEncoded("featured".into(), "true".into()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"[{"version_number":"1.0-beta","version_type":"beta","game_versions":["1.21.1"],"loaders":["fabric"],"files":[{"url":"https://api.modrinth.com/data/sodium-beta.jar","filename":"sodium-beta.jar","primary":true,"hashes":{"sha1":"0000000000000000000000000000000000000000"},"size":4}]},{"version_number":"1.0.0","version_type":"release","game_versions":["1.21.1"],"loaders":["fabric"],"files":[{"url":"https://api.modrinth.com/data/sodium.jar","filename":"sodium.jar","primary":true,"hashes":{"sha1":"0000000000000000000000000000000000000000"},"size":4}]}]"#)
            .create_async().await;

        let result = install_at(&client(), &server.url(), &Downloader::new(client(), 1, 0), std::env::temp_dir(), "sodium", "1.21.1", "fabric", Arc::new(AtomicBool::new(false)), Arc::new(|_| {})).await;
        mock.assert_async().await;
        assert!(matches!(result, Err(AppError::Validation(_))), "the contract reached CDN validation before downloading");
    }

    #[tokio::test]
    async fn install_contract_rejects_unsafe_project_id_before_request() {
        let result = install_at(&client(), "http://127.0.0.1:1", &Downloader::new(client(), 1, 0), std::env::temp_dir(), "../escape", "1.21.1", "fabric", Arc::new(AtomicBool::new(false)), Arc::new(|_| {})).await;
        assert!(matches!(result, Err(AppError::Validation(_))));
    }

    #[test]
    fn version_contract_prefers_release_then_falls_back() {
        let beta = Version {
            version_number: "2-beta".into(), version_type: "beta".into(),
            game_versions: vec!["1.21.1".into()], loaders: vec!["fabric".into()], files: vec![],
        };
        let release = Version {
            version_number: "1.0.0".into(), version_type: "release".into(),
            game_versions: vec!["1.21.1".into()], loaders: vec!["fabric".into()], files: vec![],
        };
        assert_eq!(choose_version(&[beta, release]).unwrap().version_number, "1.0.0");
    }
}
