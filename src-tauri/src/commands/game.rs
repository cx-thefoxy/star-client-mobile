//! In-game commands used by the touch overlay: input, game surface, quit, renderer option.
use super::St;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum InputEvt {
    Key { key: i32, down: bool },
    Mouse { button: i32, down: bool },
    Cursor { x: f32, y: f32 },
    Scroll { dy: f64 },
    Char { ch: u32 },
}

/// Raw input in GLFW codes, forwarded to the `:jvm` process. Fire and forget.
#[tauri::command]
pub fn game_input(evt: InputEvt) {
    match evt {
        InputEvt::Key { key, down } => crate::android::send_input("key", key, 0, down, 0.0, 0.0, 0.0),
        InputEvt::Mouse { button, down } => crate::android::send_input("mouse", 0, button, down, 0.0, 0.0, 0.0),
        InputEvt::Cursor { x, y } => crate::android::send_input("cursor", 0, 0, false, x, y, 0.0),
        InputEvt::Char { ch } => crate::android::send_input("char", ch as i32, 0, false, 0.0, 0.0, 0.0),
        InputEvt::Scroll { dy } => crate::android::send_input("scroll", 0, 0, false, 0.0, 0.0, dy),
    }
}

/// Shows or hides the native game Surface behind the (transparent) web view. `scale` = resolution scale 0.25..1.
#[tauri::command]
pub fn game_surface(show: bool, scale: f32) { crate::android::set_surface(show, scale.clamp(0.25, 1.0)); }

/// Kills the `:jvm` process (the game).
#[tauri::command]
pub async fn stop_game(st: St<'_>) -> AppResult<()> {
    crate::android::stop_game();
    for g in st.games.list().await { st.games.release(&g.instance_id).await; }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileOptsIn { pub renderer: String }

#[tauri::command]
pub async fn set_mobile_opts(st: St<'_>, opts: MobileOptsIn) -> AppResult<()> {
    if !matches!(opts.renderer.as_str(), "Holy GL4ES" | "LTW") { return Err(AppError::Validation("unknown renderer".into())); }
    st.mobile.lock().await.renderer = opts.renderer;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo { ram_mb: Option<u64>, cores: usize, abi: &'static str }

#[tauri::command]
pub fn device_info(st: St<'_>) -> DeviceInfo {
    DeviceInfo { ram_mb: st.total_ram_mb, cores: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4), abi: std::env::consts::ARCH }
}
