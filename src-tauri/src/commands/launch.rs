use super::{accounts::ensure_session, St};
use crate::error::{AppError, AppResult};
use crate::instances::LoaderKind;
use crate::minecraft::{arguments, install, java, launch, manifest, rules::Environment, version_json::VersionJson};
use crate::downloads::Progress;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LaunchState {
    instance_id: String,
    stage: &'static str,
    /// English diagnostic text. The UI localizes from `stage`, `progress` and `code`.
    message: String,
    progress: Option<Progress>,
    /// `AppError::code()` for the `failed` stage, so the UI can show a localized title.
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
}

fn emit(app: &AppHandle, id: &str, stage: &'static str, message: impl Into<String>, progress: Option<Progress>) {
    let _ = app.emit("launch-state", LaunchState { instance_id: id.into(), stage, message: message.into(), progress, code: None });
}

/// Full pipeline for one instance: install if needed → resolve Java → spawn. Emits `launch-state`.
#[tauri::command]
pub async fn launch_instance(app: AppHandle, st: St<'_>, instance_id: String, account_id: String) -> AppResult<()> {
    let inst = st.instances.lock().await.get(&instance_id)?.clone();
    st.games.reserve(&instance_id, &inst.version_id).await?;
    let result = run_launch(&app, &st, &inst, &account_id).await;
    if let Err(e) = &result {
        st.games.release(&instance_id).await;
        st.cancels.lock().await.remove(&instance_id);
        tracing::error!("launch of {} failed: {}", inst.version_id, e);
        let message = crate::auth::redact::redact(&e.to_string());
        let _ = app.emit("launch-state", LaunchState { instance_id: instance_id.clone(), stage: "failed", message, progress: None, code: Some(e.code()) });
    }
    result
}

async fn run_launch(app: &AppHandle, st: &St<'_>, inst: &crate::instances::Instance, account_id: &str) -> AppResult<()> {
    let id = inst.id.clone();
    emit(app, &id, "checking", "Checking installation", None);
    let settings = st.settings.lock().await.clone();
    let dirs = st.dirs().await;
    let env = Environment::current(HashMap::from([("has_custom_resolution".into(), inst.resolution.is_some() || (!settings.minecraft.use_default_resolution && settings.minecraft.width > 0))]));
    let cancel = Arc::new(AtomicBool::new(false));
    st.cancels.lock().await.insert(id.clone(), cancel.clone());

    let dl = st.downloader().await;
    let (manifest, _) = manifest::load(&dl, &st.paths.cache, false).await?;
    let sink = {
        let app = app.clone();
        let id = id.clone();
        Arc::new(move |p: &Progress| emit(&app, &id, "downloading", format!("{} · {}/{}", p.phase, p.done_files, p.total_files), Some(p.clone())))
    };
    let game_dir_for_install = st.instances.lock().await.game_dir(&id)?;

    // Forge / NeoForge need their installer to run as a separate Java process; Android can only host one JVM (the game).
    if matches!(inst.loader, LoaderKind::Forge | LoaderKind::NeoForge) {
        return Err(AppError::Validation("Forge and NeoForge are not supported on Android yet. Use Vanilla, Fabric or Quilt.".into()));
    }
    let java_ready: Option<std::path::PathBuf> = None;
    let loader_profile: Option<String> = None;

    let req = install::InstallRequest {
        version_id: &inst.version_id,
        loader: inst.loader,
        loader_version: inst.loader_version.as_deref(),
        loader_profile_id: loader_profile.as_deref(),
        instance_game_dir: game_dir_for_install,
    };
    let resolved = install::ensure_installed(&dl, &dirs, &manifest, &env, req, cancel.clone(), sink).await?;
    emit(app, &id, "preparing", "Preparing runtime", None);

    // Java: the runtime bundled in the APK that matches the version (unpacked on first use).
    let required = resolved.version.java_version.as_ref().map(|j| j.major_version).unwrap_or(8);
    emit(app, &id, "preparing", format!("Preparing Java {}", crate::android::bundled_major(required)), None);
    let jre_dir = match java_ready { Some(p) => p, None => java::resolve_bundled(&st.paths.runtimes, required).await? };

    // Natives
    let natives_dir = dirs.versions.join(&resolved.profile_id).join("natives");
    if natives_dir.exists() { let _ = std::fs::remove_dir_all(&natives_dir); }
    for (jar, exclude) in &resolved.native_jars {
        crate::minecraft::natives::extract(jar, &natives_dir, exclude)?;
    }

    // Account
    let (token, name, uuid) = ensure_session(st, account_id).await?;
    let game_dir = st.instances.lock().await.game_dir(&id)?;
    std::fs::create_dir_all(&game_dir)?;
    if inst.star_mod_enabled {
        crate::star::sync(&game_dir, &inst.version_id, "fabric", true, st.resource_dir.as_deref())?;
    }
    let max = inst.max_memory_mb.unwrap_or(settings.java.max_memory_mb);
    let min = settings.java.min_memory_mb.min(max);
    // Pojav's patched GLFW classes (route LWJGL's GLFW to libpojavexec). They must come first on the classpath.
    let mut classpath: Vec<String> = resolved.classpath.iter().map(|p| p.display().to_string()).collect();
    let glfw = st.paths.root.join("components/lwjgl3/lwjgl-glfw-classes.jar");
    if crate::android::extract_asset("components/lwjgl3/lwjgl-glfw-classes.jar", &glfw)? { classpath.insert(0, glfw.display().to_string()); }
    else { tracing::warn!("lwjgl-glfw-classes.jar is not bundled in this APK: the game will not get a window"); }
    let ctx = arguments::LaunchContext {
        player_name: name, uuid: uuid.clone(), access_token: token.clone(), xuid: String::new(), user_type: if token.is_empty() { "legacy" } else { "msa" }.into(),
        version_name: resolved.profile_id.clone(), version_type: manifest.versions.iter().find(|v| v.id == resolved.base_id).map(|v| v.kind.clone()).unwrap_or_else(|| "release".into()),
        game_dir: game_dir.display().to_string(), assets_root: dirs.assets.display().to_string(),
        assets_index_name: resolved.asset_index_id.clone(), game_assets: resolved.game_assets.display().to_string(),
        natives_dir: natives_dir.display().to_string(), library_dir: dirs.libraries.display().to_string(),
        classpath,
        resolution: inst.resolution.or(if settings.minecraft.use_default_resolution { None } else { Some((settings.minecraft.width, settings.minecraft.height)) }),
        fullscreen: inst.fullscreen.unwrap_or(settings.minecraft.fullscreen),
        min_memory_mb: min, max_memory_mb: max, extra_jvm_args: settings.java.jvm_args.split_whitespace().map(String::from).chain(inst.jvm_args.iter().cloned()).collect(),
        logging_config_path: resolved.logging_config.as_ref().map(|p| p.display().to_string()),
        launcher_version: env!("CARGO_PKG_VERSION").into(),
    };
    let version: &VersionJson = &resolved.version;
    let argv = arguments::build(version, &ctx, &env)?;
    tracing::info!("launching {} with java major {} args {:?}", resolved.profile_id, required, arguments::redacted(&argv, &token));

    st.cancels.lock().await.remove(&id);
    st.instances.lock().await.touch_played(&id)?;
    emit(app, &id, "starting", "Starting Minecraft", None);
    let opts = st.mobile.lock().await.clone();
    launch::spawn(app.clone(), st.games.clone(), launch::Spawn {
        instance_id: id.clone(), java: jre_dir, args: argv, game_dir, log_dir: st.paths.logs.join("game"), secret: token,
        tmp_dir: st.paths.cache.join("tmp"), renderer: opts.renderer,
    }).await?;
    emit(app, &id, "running", "Game running", None);
    Ok(())
}

/// Cancels pre-launch downloads. Does nothing once the game process has started.
#[tauri::command]
pub async fn cancel_launch(st: St<'_>, instance_id: String) -> AppResult<()> {
    if let Some(flag) = st.cancels.lock().await.get(&instance_id) { flag.store(true, Ordering::Relaxed); }
    Ok(())
}

#[tauri::command]
pub async fn running_games(st: St<'_>) -> AppResult<Vec<launch::RunningGame>> { Ok(st.games.list().await) }

