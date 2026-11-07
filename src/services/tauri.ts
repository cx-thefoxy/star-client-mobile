// Single typed gateway to the Rust backend. Pages never call invoke() directly.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type * as T from "../types/api";

export class BackendError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "BackendError"; }
}

async function call<R>(cmd: string, args?: Record<string, unknown>): Promise<R> {
  try {
    return await invoke<R>(cmd, args);
  } catch (e) {
    const err = e as Partial<T.AppErrorPayload> | string;
    if (typeof err === "object" && err && "code" in err) throw new BackendError(String(err.code), String(err.message ?? ""));
    throw new BackendError("unknown", String(err));
  }
}

export const api = {
  appInfo: () => call<T.AppInfo>("app_info"),
  getSettings: () => call<T.Settings>("get_settings"),
  saveSettings: (settings: T.Settings) => call<T.Settings>("save_settings", { settings }),
  resetSettings: () => call<T.Settings>("reset_settings"),
  detectJava: () => call<T.JavaInstall[]>("detect_java"),
  diagnosticsReport: () => call<string>("diagnostics_report"),
  openExternal: (url: string) => call<void>("open_external", { url }),
  getNews: () => call<T.NewsItem[]>("get_news"),
  cacheInfo: () => call<{ bytes: number; path: string }>("cache_info"),
  clearCache: () => call<void>("clear_cache", { confirm: true }),

  listVersions: (force = false) => call<T.VersionList>("list_versions", { force }),
  loaderCompat: (loader: T.LoaderKind, gameVersion: string) => call<T.LoaderCompat>("loader_compat", { loader, gameVersion }),
  starCompat: () => call<{ minecraft: string; loader: string; jar: string; verified: boolean }[]>("star_compat"),
  starBundled: () => call<string[]>("star_bundled"),

  listInstances: () => call<T.Instance[]>("list_instances"),
  createInstance: (draft: T.InstanceDraft) => call<T.Instance>("create_instance", { draft }),
  updateInstance: (id: string, draft: T.InstanceDraft) => call<T.Instance>("update_instance", { id, draft }),
  setInstanceFavorite: (id: string, favorite: boolean) => call<T.Instance>("set_instance_favorite", { id, favorite }),
  duplicateInstance: (id: string, copySuffix: string) => call<T.Instance>("duplicate_instance", { id, copySuffix }),
  exportInstance: (id: string) => call<string>("export_instance", { id }),
  importInstance: async (file: File) => {
    try { return await invoke<T.Instance>("import_instance", new Uint8Array(await file.arrayBuffer()), { headers: { "x-file-name": encodeURIComponent(file.name) } }); }
    catch (e) { const err = e as Partial<T.AppErrorPayload> | string; if (typeof err === "object" && err && "code" in err) throw new BackendError(String(err.code), String(err.message ?? "")); throw new BackendError("unknown", String(err)); }
  },
  deleteInstance: (id: string, confirmName: string, deleteFiles: boolean) => call<string | null>("delete_instance", { id, confirmName, deleteFiles }),

  listMods: (instanceId: string) => call<T.ModInfo[]>("list_mods", { instanceId }),
  setModEnabled: (instanceId: string, fileName: string, enabled: boolean) => call<string>("set_mod_enabled", { instanceId, fileName, enabled }),
  removeMod: (instanceId: string, fileName: string) => call<void>("remove_mod", { instanceId, fileName }),
  searchModrinth: (query: string, instanceId: string) => call<T.ModrinthProject[]>("search_modrinth", { query, instanceId }),
  installModrinth: (instanceId: string, projectId: string) => call<T.ModrinthInstallResult>("install_modrinth", { instanceId, projectId }),
  getHudConfig: (instanceId: string) => call<T.HudConfig>("get_hud_config", { instanceId }),
  saveHudConfig: (instanceId: string, config: T.HudConfig) => call<T.HudConfig>("save_hud_config", { instanceId, config }),

  listAccounts: () => call<T.AccountsView>("list_accounts"),
  signIn: () => call<T.Account>("sign_in"),
  addOfflineAccount: (username: string) => call<T.Account>("add_offline_account", { username }),
  lookupSkin: (username: string) => call<string | null>("lookup_skin", { username }),
  setActiveAccount: (id: string) => call<void>("set_active_account", { id }),
  removeAccount: (id: string) => call<void>("remove_account", { id }),

  launchInstance: (instanceId: string, accountId: string) => call<void>("launch_instance", { instanceId, accountId }),
  cancelLaunch: (instanceId: string) => call<void>("cancel_launch", { instanceId }),
  runningGames: () => call<T.RunningGame[]>("running_games"),
};

export function onLaunchState(cb: (s: T.LaunchState) => void): Promise<UnlistenFn> {
  return listen<T.LaunchState>("launch-state", (e: { payload: T.LaunchState }) => cb(e.payload));
}
export function onGameLog(cb: (g: { instanceId: string; stream: string; line: string }) => void): Promise<UnlistenFn> {
  return listen<{ instanceId: string; stream: string; line: string }>("game-log", (e) => cb(e.payload));
}
export function onGameExit(cb: (g: T.GameExit) => void): Promise<UnlistenFn> {
  return listen<T.GameExit>("game-exit", (e: { payload: T.GameExit }) => cb(e.payload));
}
