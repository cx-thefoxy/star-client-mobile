import { Component, useEffect, useMemo, useState, type CSSProperties, type ErrorInfo, type ReactElement, type ReactNode } from "react";
import { X, RotateCw } from "./components/icons";
import { useApp, resolveToast, type Page } from "./store/app";
import { Sidebar } from "./components/Sidebar";
import { Home } from "./pages/Home";
import { Instances } from "./pages/Instances";
import { Mods } from "./pages/Mods";
import { Settings } from "./pages/Settings";
import { AccountsLayer } from "./components/AccountsLayer";
import { Help } from "./pages/Help";
import Splash from "./components/Splash";
import { ControlsPage } from "./mobile/ControlsPage";
import Game from "./mobile/Game";
import Editor from "./mobile/Editor";
import { useControls } from "./mobile/controls";
import { setMobileOpts } from "./mobile/native";
import { useI18n } from "./i18n/useI18n";
import { LANGS } from "./i18n";
import { describeError } from "./i18n/errors";
import { api, onLaunchState, onGameExit } from "./services/tauri";

type PageComponent = () => ReactElement;
/** Game and editor use exactly the same box: the whole screen minus the notch / system bars (body padding would push a h-screen box off-screen). */
const FULL: CSSProperties = { boxSizing: "border-box", paddingTop: "env(safe-area-inset-top)", paddingRight: "env(safe-area-inset-right)", paddingBottom: "env(safe-area-inset-bottom)", paddingLeft: "env(safe-area-inset-left)" };

const PAGES: Record<Exclude<Page, "settings" | "editor" | "game">, PageComponent> = {
  home: Home,
  instances: Instances,
  mods: Mods,
  controls: ControlsPage,
  help: Help,
};

/** Rendered inside the language provider (store), so it follows the active language. */
function CrashFallback() {
  const { t } = useI18n();
  return (
    <div role="alert" className="grid h-screen place-items-center bg-bg p-6 text-ink">
      <div className="max-w-lg rounded-2xl border border-danger/30 bg-panel p-6 shadow-dialog">
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-danger">{t("crash.eyebrow")}</p>
        <h1 className="mt-2 text-xl font-semibold">{t("crash.title")}</h1>
        <p className="mt-2 text-sm text-ink-muted">{t("crash.body")}</p>
        <button type="button" className="mt-5 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:bg-accent-hover" onClick={() => window.location.reload()}>{t("crash.reload")}</button>
      </div>
    </div>
  );
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Star Client UI error", error, info);
  }
  render() {
    return this.state.error ? <CrashFallback /> : this.props.children;
  }
}

function AppContent() {
  const { t } = useI18n();
  const lang = useApp((s) => s.lang);
  const settings = useApp((s) => s.settings);
  const page = useApp((s) => s.page);
  const settingsOpen = useApp((s) => s.settingsOpen);
  const accountsOpen = useApp((s) => s.accountsOpen);
  const toasts = useApp((s) => s.toasts);
  const dismissToast = useApp((s) => s.dismissToast);
  const bootError = useApp((s) => s.error);
  const bootstrap = useApp((s) => s.bootstrap);
  const [splash, setSplash] = useState(true);
  const reduced = settings?.appearance.reducedMotion ?? false;
  const savedAccent = settings?.appearance.accent ?? "white";
  const dynamicAccent = settings?.appearance.dynamicAccent ?? false;
  // "Dynamic accent colors": a random non-white accent, re-rolled whenever the option is switched on.
  const randomAccent = useMemo(() => ["amber", "rose", "sky", "emerald"][Math.floor(Math.random() * 4)], [dynamicAccent]);
  const accent = dynamicAccent ? randomAccent : savedAccent === "orange" ? "white" : savedAccent; // white is the default; older saved "orange" maps to it
  const radius = settings?.appearance.cornerRadius ?? 12;
  const opacity = settings?.appearance.opacity ?? 100;
  const direction = settings?.appearance.direction ?? "ltr";

  useEffect(() => { void bootstrap(); }, []);
  // Language only changes text and typography. The document stays LTR so the
  // shell keeps the same geometry in every language; bidi isolation is per string.
  useEffect(() => {
    document.documentElement.lang = LANGS[lang].locale;
    document.documentElement.dir = direction;
    document.title = t("app.name");
  }, [lang, t, direction]);
  // The game opens full screen when it starts and the launcher comes back when it ends.
  const renderer = useControls((c) => c.renderer);
  useEffect(() => { void setMobileOpts(renderer); }, [renderer]);
  // Launch progress and game exit are handled here (not in Home) so they still work while the game screen is open.
  useEffect(() => {
    const subs = [
      onLaunchState((s) => {
        const st = useApp.getState();
        st.setLaunch(s);
        if (s.stage === "running") { api.runningGames().then((r) => useApp.setState({ running: r })).catch(() => {}); st.setPage("game"); }
      }),
      onGameExit((g) => {
        const st = useApp.getState();
        st.setLaunch(null);
        st.toast(g.crashed ? "error" : "info", { key: g.crashed ? "game.crashed" : "game.exited" });
        st.refreshAccounts().catch(() => {});
        api.runningGames().then((r) => useApp.setState({ running: r })).catch(() => {});
        st.refreshInstances().catch(() => {});
      }),
    ];
    return () => { subs.forEach((p) => p.then((u) => u()).catch(() => {})); };
  }, []);

  if (page === "game") return <div className="fixed inset-0" style={FULL}><Game /></div>;
  if (page === "editor") return <div className="fixed inset-0" style={FULL}><Editor /></div>;
  const contentPage = page === "settings" ? "home" : page;
  const Page = PAGES[contentPage];
  return (
    <>
    {splash && <Splash ready={!!settings || !!bootError} reduced={reduced} onDone={() => setSplash(false)} />}
    <div className={`app-shell flex h-screen flex-col text-ink ${reduced ? "reduced-motion" : ""}`} data-accent={accent} style={{ "--r-scale": radius / 12, ...(opacity < 100 ? { opacity: opacity / 100 } : {}) } as CSSProperties}>
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col px-3.5 pb-3 pt-2" aria-busy={!settings && !bootError}>
          {bootError ? (
            <div role="alert" className="m-auto flex max-w-md flex-col gap-3 rounded-2xl border border-danger/40 bg-danger/10 p-6 text-sm">
              <p className="font-semibold text-danger">{t("app.bootFailed")}</p>
              <p className="text-ink-muted">{t("app.bootFailedHint")}</p>
              <p className="text-xs text-ink-faint" dir="ltr">{describeError(lang, bootError)}</p>
              <div><button type="button" onClick={() => void bootstrap()} className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:bg-accent-hover"><RotateCw size={15} aria-hidden />{t("app.retry")}</button></div>
            </div>
          ) : settings ? (
            <div key={page} className="page-enter flex min-h-0 flex-1 flex-col">
              <Page />
            </div>
          ) : (
            <p className="m-auto text-sm text-ink-muted" role="status">{t("app.loading")}</p>
          )}
        </main>
        </div>
      </div>
      {settingsOpen && <Settings />}
      {accountsOpen && <AccountsLayer />}
      <div aria-live="polite" aria-label={t("toast.region")} className="pointer-events-none fixed bottom-4 start-4 z-toast flex w-80 max-w-[calc(100vw-8rem)] flex-col gap-2">
        {toasts.map((x) => (
          <div key={x.id} role={x.kind === "error" ? "alert" : "status"} className={`toast-in pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-dialog ${x.kind === "error" ? "border-danger/40 bg-panel text-danger" : "border-line bg-panel text-ink"}`}>
            <span className="min-w-0 flex-1 break-words">{resolveToast(lang, x.msg)}</span>
            <button type="button" aria-label={t("toast.dismiss")} title={t("toast.dismiss")} onClick={() => dismissToast(x.id)} className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-ink-muted hover:text-ink"><X size={14} aria-hidden /></button>
          </div>
        ))}
      </div>
    </div>
    </>
  );
}

export default function App() {
  return <AppErrorBoundary><AppContent /></AppErrorBoundary>;
}
