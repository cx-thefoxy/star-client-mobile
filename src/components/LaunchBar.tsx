import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronUp, Loader2, Shuffle, UserRound, Users } from "./icons";
import { useApp } from "../store/app";
import { api, BackendError } from "../services/tauri";
import { pct } from "../lib/format";
import { SkinHead } from "./SkinPreview";
import { MinecraftBlock } from "./MinecraftBlock";
import { useI18n } from "../i18n/useI18n";
import type { LaunchStage, LaunchState } from "../types/api";

const BUSY: LaunchStage[] = ["checking", "downloading", "preparing", "starting"];
export function LaunchBar() {
  const { t } = useI18n();
  const { instances, selectedInstance, accounts, launch, running, toast, setPage, setLaunch } = useApp();
  const [menu, setMenu] = useState<null | "instance">(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const inst = instances.find((i) => i.id === selectedInstance) ?? null;
  const acc = accounts?.accounts.find((a) => a.id === accounts.active) ?? null;
  const isRunningHere = !!inst && running.some((g) => g.instanceId === inst.id);
  const busy = !!launch && BUSY.includes(launch.stage) && launch.instanceId === inst?.id;
  const failedHere = launch?.stage === "failed" && launch.instanceId === inst?.id;
  const authConfigured = accounts?.auth.configured ?? false;
  const percent = useMemo(() => (launch?.progress ? pct(launch.progress) : null), [launch]);

  // Escape closes an open picker.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu]);

  const onLaunch = async () => {
    if (!inst) return setPage("instances");
    if (!acc) { useApp.getState().openAccounts(); return; }
    if (busy) return api.cancelLaunch(inst.id).catch((e) => toast("error", { error: e }));
    if (isRunningHere) return;
    setLaunch({ instanceId: inst.id, stage: "checking", message: "", progress: null });
    try {
      await api.launchInstance(inst.id, acc.id);
    } catch (e) {
      const err = e instanceof BackendError ? e : new BackendError("unknown", String(e));
      if (err.code === "cancelled") {
        setLaunch(null);
        toast("info", { key: "launch.cancelled" });
        return;
      }
      setLaunch({ instanceId: inst.id, stage: "failed", message: err.message, progress: null, code: err.code });
      toast("error", { error: err });
    }
  };

  // "Quick play" from the Instances menu sets pendingLaunch; start the real launch once this bar is mounted.
  const pendingLaunch = useApp((s) => s.pendingLaunch);
  useEffect(() => {
    if (!pendingLaunch || pendingLaunch !== inst?.id || !accounts) return;
    useApp.setState({ pendingLaunch: null });
    if (!acc) { toast("error", { key: "launch.needAccount" }); useApp.getState().openAccounts(); return; }
    void onLaunch();
  }, [pendingLaunch, inst?.id, accounts, acc?.id]);

  const stageLabel = (l: LaunchState | null): string => {
    if (!l) return t("launch.stage.checking");
    switch (l.stage) {
      case "checking": return t("launch.stage.checking");
      case "downloading": return percent !== null ? t("launch.stage.downloadingPct", { percent: Math.round(percent) }) : t("launch.stage.downloading");
      case "preparing": return t("launch.stage.preparing");
      case "starting": return t("launch.stage.starting");
      default: return t("launch.stage.failed");
    }
  };

  let label = t("launch.play");
  let spinner = false;
  if (busy) {
    label = stageLabel(launch);
    spinner = true;
  } else if (isRunningHere) {
    label = t("status.running");
  } else if (failedHere) {
    label = t("launch.stage.failed");
  }

  const playDisabled = !inst || isRunningHere || (!acc && !authConfigured);
  const nextInstance = () => {
    if (instances.length < 2) return;
    const at = instances.findIndex((i) => i.id === selectedInstance);
    useApp.setState({ selectedInstance: instances[(at + 1) % instances.length].id });
  };

  const dropdown = "menu-pop-up absolute bottom-full mb-2 w-72 rounded-2xl border border-line bg-panel p-1.5 shadow-dialog z-dropdown";
  const pill = "flex h-[2.375rem] items-center justify-between gap-2 rounded-full bg-raised ps-3 pe-2.5 text-start transition-colors hover:bg-control-hover focus-visible:outline-accent";
  const round = "grid h-[2.375rem] w-[2.375rem] shrink-0 place-items-center rounded-full transition-colors focus-visible:outline-accent disabled:opacity-40";

  return (
    <div className="shell-bar relative flex flex-col rounded-[22px] bg-panel p-3">
      <div className="flex items-center gap-2">
        {/* instance selector */}
        <div className="relative min-w-0 flex-1 basis-0 max-w-[14rem]">
          <button type="button" aria-haspopup="listbox" aria-expanded={menu === "instance"} aria-label={t("launch.instancePicker")} onClick={() => setMenu(menu === "instance" ? null : "instance")} className={`${pill} w-full`}>
            <span className="flex min-w-0 items-center gap-2.5">
              <MinecraftBlock size="sm" />
              <span className="truncate text-sm font-semibold" dir="ltr">{inst ? inst.name : t(instances.length ? "launch.instancePicker" : "launch.noInstances")}</span>
            </span>
            <ChevronUp size={16} className="shrink-0 text-ink-muted" aria-hidden />
          </button>
          {menu === "instance" && (
            <div ref={menuRef} className={`${dropdown} max-h-80 overflow-y-auto`} role="listbox" aria-label={t("launch.instancePicker")}>
              {instances.length === 0 && <p className="p-3 text-sm text-ink-muted">{t("launch.noInstances")}</p>}
              {instances.map((i) => (
                <button key={i.id} type="button" role="option" aria-selected={i.id === selectedInstance} onClick={() => { useApp.setState({ selectedInstance: i.id }); setMenu(null); }}
                  className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-start hover:bg-white/5">
                  <MinecraftBlock size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-semibold">{i.name}</span>
                    <span className="block truncate text-xs text-ink-muted" dir="ltr">{[t(`loader.${i.loader}`), i.versionId, i.loader !== "vanilla" ? i.loaderVersion : null].filter(Boolean).join(" • ")}</span>
                  </span>
                  {i.id === selectedInstance && <Check size={18} className="shrink-0 text-ink" aria-hidden />}
                </button>
              ))}
              <button type="button" onClick={() => { setMenu(null); setPage("instances"); useApp.getState().requestCreateInstance(); }} className="mt-1 w-full rounded-xl px-3 py-2 text-start text-sm text-accent hover:bg-white/5">+ {t("launch.createInstance")}</button>
            </div>
          )}
        </div>

        <button type="button" aria-label={t("launch.nextInstance")} title={t("launch.nextInstance")} onClick={nextInstance} disabled={instances.length < 2 || busy}
          className={`${round} bg-accent-dim text-accent hover:bg-accent/25`}><Shuffle size={16} aria-hidden /></button>

        {/* account button: opens the accounts layer */}
        <button type="button" aria-haspopup="dialog" aria-label={t("launch.manageAccounts")} title={t("launch.manageAccounts")} onClick={() => useApp.getState().openAccounts()} className={`${pill} min-w-0 flex-1 basis-0 max-w-[14rem]`}>
          <span className="flex min-w-0 items-center gap-2.5">
            {acc ? <SkinHead account={acc} className="h-6 w-6" /> : <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-control"><UserRound size={14} className="text-ink-muted" aria-hidden /></span>}
            <span className="truncate text-sm font-semibold">{acc ? acc.name : t("launch.noAccount")}</span>
          </span>
          <ChevronUp size={16} className="shrink-0 text-ink-muted" aria-hidden />
        </button>

        <button type="button" aria-label={t("launch.accountsOverview")} title={t("launch.accountsOverview")} onClick={() => useApp.getState().openAccounts()} className={`${round} bg-raised text-ink-muted hover:bg-control-hover hover:text-ink`}><Users size={16} aria-hidden /></button>

        <div className="ms-auto flex shrink-0 items-center">
          <button
            type="button"
            onClick={onLaunch}
            disabled={playDisabled}
            aria-busy={busy || undefined}
            title={busy ? t("launch.cancelHint") : undefined}
            className="relative h-10 whitespace-nowrap min-w-[8.5rem] overflow-hidden rounded-full bg-accent px-5 text-[0.9375rem] font-semibold text-accent-ink transition-colors hover:bg-accent-hover active:brightness-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && percent !== null && <span aria-hidden className="absolute inset-y-0 start-0 bg-black/20 transition-[width] duration-300" style={{ width: `${percent}%` }} />}
            <span className="relative flex items-center justify-center gap-2">{spinner && <Loader2 size={16} className="animate-spin" aria-hidden />}<span>{label}</span></span>
          </button>
        </div>
      </div>
      {menu && <div className="fixed inset-0 z-30" aria-hidden onMouseDown={() => setMenu(null)} />}

    </div>
  );
}
