import { create } from "zustand";
import type * as T from "../types/api";
import { api, BackendError } from "../services/tauri";
import { DEFAULT_LANG, normalizeLang, translate, type Key, type Lang, type Params } from "../i18n";
import { describeError } from "../i18n/errors";

export type Page = "home" | "instances" | "mods" | "controls" | "help" | "settings" | "editor" | "game";

/** A toast body is resolved at render time so it follows the current language. */
export type ToastMsg = { key: Key; params?: Params } | { raw: string } | { error: unknown };
export interface Toast { id: number; kind: "info" | "error"; msg: ToastMsg }

const LANG_CACHE_KEY = "star.lang";
/** The Rust settings file is the source of truth. This cache only avoids a wrong-language
 *  flash while settings are still loading. */
function readCachedLang(): Lang {
  try { return normalizeLang(localStorage.getItem(LANG_CACHE_KEY)); } catch { return DEFAULT_LANG; }
}
function writeCachedLang(l: Lang) {
  try { localStorage.setItem(LANG_CACHE_KEY, l); } catch { /* storage unavailable: harmless */ }
}

export type Theme = "dark" | "light";
const THEME_CACHE_KEY = "star.theme";
const normalizeTheme = (x: unknown): Theme => (x === "light" ? "light" : "dark");
/** Same idea as the language cache: avoids a dark flash before settings load. Dark is the default. */
function readCachedTheme(): Theme {
  try { return normalizeTheme(localStorage.getItem(THEME_CACHE_KEY)); } catch { return "dark"; }
}
export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_CACHE_KEY, t); } catch { /* harmless */ }
}
applyTheme(readCachedTheme());

interface AppState {
  lang: Lang;
  page: Page;
  settingsOpen: boolean;
  /** The accounts layer (opens over any page, like Settings). */
  accountsOpen: boolean;
  pendingLaunch: string | null;
  modsView: "installed" | "discover";
  /** Instances page shows only starred instances (the heart in the rail). */
  favoritesOnly: boolean;
  settings: T.Settings | null;
  info: T.AppInfo | null;
  versions: T.VersionList | null;
  selectedVersion: string | null;
  instances: T.Instance[];
  selectedInstance: string | null;
  accounts: T.AccountsView | null;
  launch: T.LaunchState | null;
  running: T.RunningGame[];
  toasts: Toast[];
  error: BackendError | null;
  /** Bumped whenever a page wants to open its own create form, e.g. from Versions. */
  createRequest: number;

  setPage: (p: Page) => void;
  /** Rail shortcuts that open a page in a specific sub-view. */
  openInstances: (favoritesOnly?: boolean) => void;
  openMods: (view: "installed" | "discover") => void;
  openSettings: () => void;
  closeSettings: () => void;
  openAccounts: () => void;
  closeAccounts: () => void;
  bootstrap: () => Promise<void>;
  refreshVersions: (force?: boolean) => Promise<void>;
  selectVersion: (id: string) => void;
  refreshInstances: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  applySettings: (s: T.Settings) => void;
  saveSettings: (s: T.Settings) => Promise<void>;
  setLanguage: (l: Lang) => Promise<void>;
  toast: (kind: Toast["kind"], msg: ToastMsg | string) => void;
  dismissToast: (id: number) => void;
  setLaunch: (s: T.LaunchState | null) => void;
  requestCreateInstance: () => void;
}

let toastSeq = 1;
const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

export const useApp = create<AppState>((set, get) => ({
  lang: readCachedLang(),
  page: "home",
  settingsOpen: false,
  accountsOpen: false,
  pendingLaunch: null,
  modsView: "installed",
  favoritesOnly: false,
  settings: null,
  info: null,
  versions: null,
  selectedVersion: null,
  instances: [],
  selectedInstance: null,
  accounts: null,
  launch: null,
  running: [],
  toasts: [],
  error: null,
  createRequest: 0,

  setPage: (page) => set(page === "settings" ? { settingsOpen: true, accountsOpen: false } : { page, settingsOpen: false, ...(page === "instances" ? { favoritesOnly: false } : {}) }),
  openInstances: (favoritesOnly = false) => set({ page: "instances", settingsOpen: false, favoritesOnly }),
  openMods: (view) => set({ page: "mods", settingsOpen: false, modsView: view }),
  openSettings: () => set({ settingsOpen: true, accountsOpen: false }),
  closeSettings: () => set({ settingsOpen: false }),
  openAccounts: () => set({ accountsOpen: true, settingsOpen: false }),
  closeAccounts: () => set({ accountsOpen: false }),

  bootstrap: async () => {
    try {
      const [settings, info] = await Promise.all([api.getSettings(), api.appInfo()]);
      get().applySettings(settings);
      set({ info });
      await Promise.all([get().refreshVersions(), get().refreshInstances(), get().refreshAccounts()]);
      const running = await api.runningGames().catch(() => []);
      set({ running });
      // The app was closed/reopened while the game kept running: go straight back into it.
      if (running.length > 0) set({ page: "game" });
    } catch (e) {
      set({ error: e instanceof BackendError ? e : new BackendError("unknown", String(e)) });
    }
  },

  refreshVersions: async (force = false) => {
    try {
      const versions = await api.listVersions(force);
      const current = get().selectedVersion;
      set({ versions, selectedVersion: current && versions.versions.some((v) => v.id === current) ? current : versions.latestRelease });
      if (versions.stale) get().toast("info", { key: "versions.staleToast" });
    } catch (e) {
      get().toast("error", { error: e });
    }
  },

  selectVersion: (id) => set({ selectedVersion: id }),

  refreshInstances: async () => {
    const instances = await api.listInstances();
    const sel = get().selectedInstance;
    set({ instances, selectedInstance: instances.some((i) => i.id === sel) ? sel : null });
  },

  refreshAccounts: async () => {
    const accounts = await api.listAccounts();
    set({ accounts });
  },

  applySettings: (settings) => {
    const lang = normalizeLang(settings.appearance.language);
    writeCachedLang(lang);
    applyTheme(normalizeTheme(settings.appearance.theme));
    set({ settings, lang });
  },

  saveSettings: async (s) => {
    const saved = await api.saveSettings(s);
    get().applySettings(saved);
  },

  setLanguage: async (l) => {
    const s = get().settings;
    if (!s) { set({ lang: l }); writeCachedLang(l); return; }
    await get().saveSettings({ ...s, appearance: { ...s.appearance, language: l } });
  },

  toast: (kind, msg) => {
    const id = toastSeq++;
    const body: ToastMsg = typeof msg === "string" ? { raw: msg } : msg;
    set((st) => ({ toasts: [...st.toasts, { id, kind, msg: body }].slice(-4) }));
    toastTimers.set(id, setTimeout(() => get().dismissToast(id), kind === "error" ? 8000 : 4000));
  },
  dismissToast: (id) => {
    clearTimeout(toastTimers.get(id));
    toastTimers.delete(id);
    set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) }));
  },
  setLaunch: (launch) => set({ launch }),
  requestCreateInstance: () => set((st) => ({ page: "instances", createRequest: st.createRequest + 1 })),
}));

/** Resolve a toast body for the active language. */
export function resolveToast(lang: Lang, m: ToastMsg): string {
  if ("key" in m) return translate(lang, m.key, m.params);
  if ("raw" in m) return m.raw;
  return describeError(lang, m.error);
}
