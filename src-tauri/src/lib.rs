//! Star Client Mobile backend (Tauri 2, Android).
pub mod android;
pub mod auth;
pub mod commands;
pub mod config;
pub mod diagnostics;
pub mod downloads;
pub mod error;
pub mod instances;
pub mod loaders;
pub mod logging;
pub mod minecraft;
pub mod mods;
pub mod modrinth;
pub mod paths;
pub mod star;
pub mod state;

use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let paths = paths::AppPaths::resolve(root)?;
            paths.ensure()?;
            let guard = logging::init(&paths.logs);
            let resource_dir = app.path().resource_dir().ok();
            let st = Arc::new(state::AppState::new(paths, guard, resource_dir));
            app.manage(st);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system::app_info,
            commands::system::get_settings,
            commands::system::save_settings,
            commands::system::reset_settings,
            commands::system::detect_java,
            commands::system::diagnostics_report,
            commands::system::open_external,
            commands::system::get_news,
            commands::system::cache_info,
            commands::system::clear_cache,
            commands::library::list_versions,
            commands::library::loader_compat,
            commands::library::star_compat,
            commands::library::star_bundled,
            commands::library::list_instances,
            commands::library::create_instance,
            commands::library::update_instance,
            commands::library::delete_instance,
            commands::library::set_instance_favorite,
            commands::library::duplicate_instance,
            commands::library::export_instance,
            commands::library::import_instance,
            commands::library::list_mods,
            commands::library::set_mod_enabled,
            commands::library::remove_mod,
            commands::library::search_modrinth,
            commands::library::install_modrinth,
            commands::library::get_hud_config,
            commands::library::save_hud_config,
            commands::accounts::list_accounts,
            commands::accounts::sign_in,
            commands::accounts::add_offline_account,
            commands::accounts::lookup_skin,
            commands::accounts::set_active_account,
            commands::accounts::remove_account,
            commands::launch::launch_instance,
            commands::launch::cancel_launch,
            commands::launch::running_games,
            commands::game::game_input,
            commands::game::game_surface,
            commands::game::stop_game,
            commands::game::set_mobile_opts,
            commands::game::device_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Star Client");
}
