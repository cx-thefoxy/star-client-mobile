//! Account metadata in `accounts.json`; refresh tokens in a private file
//! (see `FileSecrets`). Minecraft access tokens
//! live in memory only.
use crate::config::write_atomic;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AccountType { Microsoft, Offline }

impl Default for AccountType {
    fn default() -> Self { Self::Microsoft }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub skin_url: Option<String>,
    pub added_at: String,
    pub needs_relogin: bool,
    #[serde(default)]
    pub account_type: AccountType,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct File { schema_version: u32, accounts: Vec<Account>, active: Option<String> }

pub struct Session { pub access_token: String, pub expires_at: i64, pub xuid: String }

pub trait SecretStore: Send + Sync {
    fn set(&self, key: &str, value: &str) -> AppResult<()>;
    fn get(&self, key: &str) -> AppResult<Option<String>>;
    fn delete(&self, key: &str) -> AppResult<()>;
}

/// Refresh tokens live in `secrets.json` inside the app's private data directory (Android app sandbox:
/// no other app can read it). Written atomically; never part of accounts.json or any log.
pub struct FileSecrets { path: PathBuf, lock: std::sync::Mutex<()> }
impl FileSecrets {
    pub fn new(root: &Path) -> Self { Self { path: root.join("secrets.json"), lock: std::sync::Mutex::new(()) } }
    fn read(&self) -> HashMap<String, String> {
        std::fs::read(&self.path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }
    fn write(&self, m: &HashMap<String, String>) -> AppResult<()> { write_atomic(&self.path, &serde_json::to_vec(m)?) }
}
impl SecretStore for FileSecrets {
    fn set(&self, key: &str, value: &str) -> AppResult<()> {
        let _g = self.lock.lock().unwrap();
        let mut m = self.read(); m.insert(key.into(), value.into()); self.write(&m)
    }
    fn get(&self, key: &str) -> AppResult<Option<String>> { let _g = self.lock.lock().unwrap(); Ok(self.read().get(key).cloned()) }
    fn delete(&self, key: &str) -> AppResult<()> {
        let _g = self.lock.lock().unwrap();
        let mut m = self.read(); m.remove(key); self.write(&m)
    }
}

pub struct AccountStore {
    path: PathBuf,
    file: File,
    pub sessions: HashMap<String, Session>,
    secrets: Box<dyn SecretStore>,
}

fn refresh_key(id: &str) -> String { format!("ms-refresh:{id}") }

impl AccountStore {
    pub fn load(root: &Path, secrets: Box<dyn SecretStore>) -> Self {
        let path = root.join("accounts.json");
        let file = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Self { path, file, sessions: HashMap::new(), secrets }
    }
    fn save(&self) -> AppResult<()> {
        write_atomic(&self.path, &serde_json::to_vec_pretty(&File { schema_version: 1, accounts: self.file.accounts.clone(), active: self.file.active.clone() })?)
    }
    pub fn list(&self) -> (&[Account], Option<&str>) { (&self.file.accounts, self.file.active.as_deref()) }

    pub fn upsert(&mut self, acc: Account, refresh_token: Option<&str>, session: Session) -> AppResult<()> {
        if let Some(rt) = refresh_token { self.secrets.set(&refresh_key(&acc.id), rt)?; }
        self.sessions.insert(acc.id.clone(), session);
        self.file.accounts.retain(|a| a.id != acc.id);
        self.file.active = Some(acc.id.clone());
        self.file.accounts.push(acc);
        self.save()
    }
    pub fn set_active(&mut self, id: &str) -> AppResult<()> {
        if !self.file.accounts.iter().any(|a| a.id == id) { return Err(AppError::NotFound("account".into())); }
        self.file.active = Some(id.into());
        self.save()
    }
    pub fn mark_relogin(&mut self, id: &str) -> AppResult<()> {
        if let Some(a) = self.file.accounts.iter_mut().find(|a| a.id == id) { a.needs_relogin = true; }
        self.sessions.remove(id);
        self.save()
    }
    pub fn remove(&mut self, id: &str) -> AppResult<()> {
        self.secrets.delete(&refresh_key(id))?;
        self.sessions.remove(id);
        self.file.accounts.retain(|a| a.id != id);
        if self.file.active.as_deref() == Some(id) { self.file.active = self.file.accounts.first().map(|a| a.id.clone()); }
        self.save()
    }
    pub fn account(&self, id: &str) -> AppResult<Account> {
        self.file.accounts.iter().find(|a| a.id == id).cloned().ok_or_else(|| AppError::NotFound("account".into()))
    }
    pub fn add_offline(&mut self, name: String) -> AppResult<Account> {
        let id = format!("offline:{}", name.to_lowercase());
        if self.file.accounts.iter().any(|a| a.id == id) {
            return Err(AppError::Validation("an offline account with this username already exists".into()));
        }
        let acc = Account {
            id: id.clone(), name, skin_url: None,
            added_at: chrono::Utc::now().to_rfc3339(), needs_relogin: false,
            account_type: AccountType::Offline,
        };
        self.sessions.insert(id.clone(), Session { access_token: String::new(), expires_at: i64::MAX, xuid: String::new() });
        self.file.active = Some(id);
        self.file.accounts.push(acc.clone());
        self.save()?;
        Ok(acc)
    }
    pub fn refresh_token(&self, id: &str) -> AppResult<Option<String>> { self.secrets.get(&refresh_key(id)) }
    pub fn valid_session(&self, id: &str) -> Option<&Session> {
        self.sessions.get(id).filter(|s| s.expires_at > chrono::Utc::now().timestamp())
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    pub struct MemSecrets(pub Mutex<HashMap<String, String>>);
    impl SecretStore for MemSecrets {
        fn set(&self, k: &str, v: &str) -> AppResult<()> { self.0.lock().unwrap().insert(k.into(), v.into()); Ok(()) }
        fn get(&self, k: &str) -> AppResult<Option<String>> { Ok(self.0.lock().unwrap().get(k).cloned()) }
        fn delete(&self, k: &str) -> AppResult<()> { self.0.lock().unwrap().remove(k); Ok(()) }
    }

    #[test]
    fn tokens_never_written_to_json() {
        let t = tempfile::tempdir().unwrap();
        let mut s = AccountStore::load(t.path(), Box::new(MemSecrets::default()));
        let acc = Account { id: "abc".into(), name: "Steve".into(), skin_url: None, added_at: "now".into(), needs_relogin: false, account_type: AccountType::Microsoft };
        s.upsert(acc, Some("REFRESH_SECRET"), Session { access_token: "ACCESS_SECRET".into(), expires_at: i64::MAX, xuid: "".into() }).unwrap();
        let json = std::fs::read_to_string(t.path().join("accounts.json")).unwrap();
        assert!(!json.contains("SECRET"));
        assert_eq!(s.refresh_token("abc").unwrap().as_deref(), Some("REFRESH_SECRET"));
        assert!(s.valid_session("abc").is_some());
        s.mark_relogin("abc").unwrap();
        assert!(s.valid_session("abc").is_none());
        s.remove("abc").unwrap();
        assert!(s.refresh_token("abc").unwrap().is_none());
        assert!(s.list().0.is_empty());
    }
}
