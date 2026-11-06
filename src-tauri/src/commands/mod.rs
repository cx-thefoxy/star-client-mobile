pub mod accounts;
pub mod game;
pub mod launch;
pub mod library;
pub mod system;

use crate::state::AppState;
use std::sync::Arc;
pub type St<'a> = tauri::State<'a, Arc<AppState>>;
