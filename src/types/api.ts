// Mirrors the Rust serde shapes. Keep in sync with src-tauri/src/**.
export type Category = "release" | "snapshot" | "pre_release" | "release_candidate" | "old_beta" | "old_alpha" | "other";
export type InstallStatus = "installed" | "incomplete" | "not_installed";
export type LoaderKind = "vanilla" | "fabric" | "quilt" | "forge" | "neoforge";

export interface AppErrorPayload { code: string; message: string }

export interface VersionRow {
  id: string;
  kind: string;
  category: Category;
  releaseTime: string;
  url: string;
  status: InstallStatus;
  javaMajor: number | null;
}
export interface VersionList { latestRelease: string; latestSnapshot: string; stale: boolean; versions: VersionRow[] }

export interface Instance {
  id: string;
  name: string;
  versionId: string;
  loader: LoaderKind;
  loaderVersion: string | null;
  maxMemoryMb: number | null;
  javaPath: string | null;
  jvmArgs: string[];
  resolution: [number, number] | null;
  fullscreen: boolean | null;
  starModEnabled: boolean;
  createdAt: string;
  lastPlayed: string | null;
  playCount: number;
  playtimeSecs: number;
  favorite: boolean;
}
export type InstanceDraft = Omit<Instance, "id" | "createdAt" | "lastPlayed" | "playCount" | "playtimeSecs" | "favorite">;

export interface Account { id: string; name: string; skinUrl: string | null; addedAt: string; needsRelogin: boolean; accountType: "microsoft" | "offline" }
export interface AuthStatus { configured: boolean; source: string | null; problem: string | null }
export interface AccountsView { accounts: Account[]; active: string | null; auth: AuthStatus }

export interface Progress {
  phase: string; totalFiles: number; doneFiles: number; totalBytes: number; doneBytes: number; skippedFiles: number;
}
export type LaunchStage = "checking" | "downloading" | "preparing" | "starting" | "running" | "failed";
export interface LaunchState { instanceId: string; stage: LaunchStage; message: string; progress: Progress | null; code?: string }
export interface GameExit { instanceId: string; code: number | null; crashed: boolean; crashReport: string | null; logFile: string }

export interface Settings {
  schemaVersion: number;
  appearance: { language: "en"; accent: string; reducedMotion: boolean; background: string; dynamicAccent: boolean; cornerRadius: number; opacity: number; direction: "ltr" | "rtl" };
  minecraft: { gameDir: string | null; preferredChannel: "release" | "snapshot"; showSnapshots: boolean; showOldBeta: boolean; showOldAlpha: boolean; defaultLoader: LoaderKind; width: number; height: number; fullscreen: boolean; closeLauncherOnStart: boolean; postLaunch: "keep" | "hide" | "close"; useDefaultResolution: boolean };
  java: { auto: boolean; customPath: string | null; minMemoryMb: number; maxMemoryMb: number; jvmArgs: string; javaPaths: string[]; gpuPreference: "automatic" | "integrated" | "dedicated" };
  downloads: { concurrency: number; retries: number };
  general: { autoStart: boolean; windowDecorations: boolean; trayBehavior: "disabled" | "minimize" | "close"; windowPosition: "normal" | "always_on_top"; discordRpc: boolean };
  lastInstanceId: string | null;
}

export interface AppInfo { version: string; os: string; arch: string; totalRamMb: number | null; dataDir: string; settingsWarning: string | null }
export interface JavaInstall { path: string; version: string; major: number; arch: string; managed: boolean }
export interface ModInfo { fileName: string; enabled: boolean; size: number; id: string | null; name: string | null; version: string | null; loader: string | null; depends: string[]; problems: string[] }
export interface ModrinthProject { id: string; slug: string; title: string; description: string; iconUrl: string | null; downloads: number; follows: number; projectType: string; categories: string[] }
export interface ModrinthInstallResult { projectId: string; fileName: string; version: string }
export interface LoaderVersion { version: string; stable: boolean }
export interface LoaderCompat { loader: LoaderKind; gameVersion: string; compatible: boolean; installable: boolean; versions: LoaderVersion[]; reason: string | null }
export interface HudConfig { fps: boolean; coords: boolean; cps: boolean; keystrokes: boolean; ping: boolean; armor: boolean; toggleSprint: boolean; zoom: boolean; zoomFactor: number; textColor: string }
export interface NewsItem { title: string; url: string | null; date: string | null; body: string | null }
export interface RunningGame { instanceId: string; pid: number | null; version: string; startedAt: string }
