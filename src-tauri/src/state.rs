use crate::auth::store::{AccountStore, FileSecrets};
use crate::config::{Settings, SettingsFile};
use crate::downloads::Downloader;
use crate::instances::InstanceStore;
use crate::minecraft::launch::GameRegistry;
use crate::paths::{AppPaths, GameDirs};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Mobile-only options set by the UI before a launch (Settings > Game).
#[derive(Clone)]
pub struct MobileOpts { pub renderer: String }

pub struct AppState {
    pub mobile: Mutex<MobileOpts>,
    pub paths: AppPaths,
    pub settings_file: SettingsFile,
    pub settings: Mutex<Settings>,
    pub settings_warning: Option<String>,
    pub instances: Mutex<InstanceStore>,
    pub accounts: Mutex<AccountStore>,
    pub http: reqwest::Client,
    pub games: GameRegistry,
    pub cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub total_ram_mb: Option<u64>,
    pub resource_dir: Option<PathBuf>,
    pub _log_guard: Option<tracing_appender::non_blocking::WorkerGuard>,
}

pub fn total_ram_mb() -> Option<u64> {
    let mut s = sysinfo::System::new();
    s.refresh_memory();
    let t = s.total_memory();
    (t > 0).then_some(t / 1_048_576)
}

impl AppState {
    pub fn new(paths: AppPaths, guard: Option<tracing_appender::non_blocking::WorkerGuard>, resource_dir: Option<PathBuf>) -> Self {
        let ram = total_ram_mb();
        let settings_file = SettingsFile::new(&paths.root);
        let (settings, warning) = settings_file.load(ram);
        let dirs = Self::dirs_for(&paths, &settings);
        let http = reqwest::Client::builder()
            .user_agent(concat!("StarClient/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(std::time::Duration::from_secs(15))
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .expect("http client");
        Self {
            mobile: Mutex::new(MobileOpts { renderer: "Holy GL4ES".into() }),
            instances: Mutex::new(InstanceStore::load(&paths.root, &dirs.instances)),
            accounts: Mutex::new(AccountStore::load(&paths.root, Box::new(FileSecrets::new(&paths.root)))),
            settings: Mutex::new(settings),
            settings_warning: warning,
            settings_file,
            http,
            games: GameRegistry::default(),
            cancels: Mutex::new(HashMap::new()),
            total_ram_mb: ram,
            resource_dir,
            paths,
            _log_guard: guard,
        }
    }

    pub fn dirs_for(paths: &AppPaths, s: &Settings) -> GameDirs {
        GameDirs::new(s.minecraft.game_dir.as_ref().map(PathBuf::from).unwrap_or_else(|| paths.default_game_root.clone()))
    }

    pub async fn dirs(&self) -> GameDirs { Self::dirs_for(&self.paths, &*self.settings.lock().await) }

    pub async fn downloader(&self) -> Downloader {
        let s = self.settings.lock().await;
        Downloader::new(self.http.clone(), s.downloads.concurrency, s.downloads.retries)
    }
}
