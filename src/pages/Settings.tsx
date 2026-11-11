import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useApp } from "../store/app";
import { Btn, Field, inputCls, Modal, Toggle, ConfirmDialog, useDialog, useLayerExit } from "../components/ui";
import { api } from "../services/tauri";
import type { AppInfo, JavaInstall, Settings as S } from "../types/api";
import { AlertTriangle, TabContrast, TabMonitor, TabSliders, TabTerminal, X, Copy, Check, RefreshCw, type IconType } from "../components/icons";
import { useControls } from "../mobile/controls";
import { useI18n } from "../i18n/useI18n";
import type { Key } from "../i18n";
import { describeError } from "../i18n/errors";

type Section = "general" | "appearance" | "game" | "advanced";
const SECTIONS: { id: Section; labelKey: Key; hintKey: Key; icon: IconType }[] = [
  { id: "general", labelKey: "settings.section.general", hintKey: "settings.sectionHint.general", icon: TabSliders },
  { id: "appearance", labelKey: "settings.section.appearance", hintKey: "settings.sectionHint.appearance", icon: TabContrast },
  { id: "game", labelKey: "settings.section.game", hintKey: "settings.sectionHint.game", icon: TabMonitor },
  { id: "advanced", labelKey: "settings.section.advanced", hintKey: "settings.sectionHint.advanced", icon: TabTerminal },
];

const LIMITS = {
  maxMem: [512, 65536], minMem: [256, 65536], width: [320, 7680], height: [240, 4320], concurrency: [1, 32], retries: [0, 10],
} as const;
const ACCENTS: { id: string; labelKey: Key; rgb: string }[] = [
  { id: "white", labelKey: "settings.accent.white", rgb: "255 255 255" },
  { id: "amber", labelKey: "settings.accent.amber", rgb: "245 165 36" },
  { id: "rose", labelKey: "settings.accent.rose", rgb: "251 113 133" },
  { id: "sky", labelKey: "settings.accent.sky", rgb: "56 189 248" },
  { id: "emerald", labelKey: "settings.accent.emerald", rgb: "52 211 153" },
];
const MEM_PRESETS = [2048, 4096, 6144, 8192, 12288, 16384];
const inRange = (v: number, [lo, hi]: readonly [number, number]) => Number.isFinite(v) && v >= lo && v <= hi;

export function Settings() {
  const { t, mb, lang } = useI18n();
  const { settings, applySettings, saveSettings, toast, closeSettings } = useApp();
  const ctl = useControls();
  const [draft, setDraft] = useState<S | null>(settings);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [java, setJava] = useState<JavaInstall[]>([]);
  const [cache, setCache] = useState<{ bytes: number; path: string } | null>(null);
  const [confirmCache, setConfirmCache] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [section, setSection] = useState<Section>("general");
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Keep unsaved edits when the language changes elsewhere; only the language is merged in.
  useEffect(() => {
    if (!settings) return;
    setDraft((d) => (d ? { ...d, appearance: { ...d.appearance, language: settings.appearance.language } } : settings));
  }, [settings]);
  useEffect(() => {
    api.appInfo().then(setInfo).catch(() => {});
    api.detectJava().then(setJava).catch(() => {});
    api.cacheInfo().then(setCache).catch(() => {});
  }, []);

  const dirty = !!draft && !!settings && JSON.stringify(draft) !== JSON.stringify(settings);
  const { leaving, leave } = useLayerExit(closeSettings);
  const requestClose = () => { if (dirty) setDiscarding(true); else leave(); };
  useDialog(dialogRef, requestClose, !discarding && !resetting && !confirmCache && !leaving);

  if (!draft) {
    return (
      <div className="fixed inset-0 z-overlay grid place-items-center bg-black/70 text-sm text-ink-muted" role="status">{t("common.loading")}</div>
    );
  }

  const ram = info?.totalRamMb ?? null;
  const memWarn = ram !== null && draft.java.maxMemoryMb > ram * 0.75;
  const set = <K extends keyof S>(k: K, v: S[K]) => setDraft({ ...draft, [k]: v });

  const errs = {
    maxMem: inRange(draft.java.maxMemoryMb, LIMITS.maxMem) ? null : t("common.rangeError", { min: LIMITS.maxMem[0], max: LIMITS.maxMem[1] }),
    minMem: !inRange(draft.java.minMemoryMb, LIMITS.minMem) ? t("common.rangeError", { min: LIMITS.minMem[0], max: LIMITS.minMem[1] })
      : draft.java.minMemoryMb > draft.java.maxMemoryMb ? t("settings.memoryMinGtMax") : null,
    width: draft.minecraft.useDefaultResolution || inRange(draft.minecraft.width, LIMITS.width) ? null : t("common.rangeError", { min: LIMITS.width[0], max: LIMITS.width[1] }),
    height: draft.minecraft.useDefaultResolution || inRange(draft.minecraft.height, LIMITS.height) ? null : t("common.rangeError", { min: LIMITS.height[0], max: LIMITS.height[1] }),
    gameDir: !draft.minecraft.gameDir && draft.minecraft.gameDir !== null ? t("settings.gameDirRequired") : null,
    concurrency: inRange(draft.downloads.concurrency, LIMITS.concurrency) ? null : t("common.rangeError", { min: 1, max: 32 }),
    retries: inRange(draft.downloads.retries, LIMITS.retries) ? null : t("common.rangeError", { min: 0, max: 10 }),
  };
  const hasErrors = Object.values(errs).some(Boolean);

  const save = async () => {
    if (hasErrors) { setSaveErr(t("settings.fixErrors")); return; }
    setSaveErr(null);
    setSaving(true);
    try { await saveSettings(draft); toast("info", { key: "settings.saved" }); }
    catch (e) { setSaveErr(describeError(lang, e)); }
    finally { setSaving(false); }
  };
  const discardAndClose = () => { setDraft(settings); setDiscarding(false); leave(); };

  const doReset = async () => {
    try {
      const s = await api.resetSettings();
      applySettings(s);
      setDraft(s);
      setResetting(false);
      toast("info", { key: "settings.resetDone" });
    } catch (e) { toast("error", { error: e }); }
  };

  const doReport = async () => {
    try {
      const r = await api.diagnosticsReport();
      setReport(r);
      await navigator.clipboard.writeText(r);
      toast("info", { key: "common.copied" });
    } catch { toast("error", { key: "common.copyFailed" }); }
  };

  const clearCache = async () => {
    setClearingCache(true);
    try {
      await api.clearCache();
      setConfirmCache(false);
      setCache(await api.cacheInfo());
      toast("info", { key: "settings.cacheCleared" });
    } catch (e) { toast("error", { error: e }); }
    finally { setClearingCache(false); }
  };

  const current = SECTIONS.find((x) => x.id === section)!;
  const fieldCls = inputCls;
  const sectionCard = (title: string, children: ReactNode, id?: string) => (
    <section id={id} className="rounded-xl border border-white/10 bg-white/[0.05] p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">{title}</h2>
      {children}
    </section>
  );
  const row = (title: string, hint: string | undefined, control: ReactNode) => (
    <div className="flex items-center justify-between gap-4">
      <span className="min-w-0"><span className="block font-medium">{title}</span>{hint && <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span>}</span>
      {control}
    </div>
  );

  const segmented = <V extends string>(label: string, value: V, options: { value: V; label: string }[], onPick: (v: V) => void) => (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-xl border border-line bg-raised p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onPick(o.value)}
          className={`rounded-[10px] px-3.5 py-1.5 text-sm transition-colors ${value === o.value ? "bg-accent font-semibold text-accent-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}><span lang={/[\u0600-\u06FF]/.test(o.label) ? "fa" : undefined}>{o.label}</span></button>
      ))}
    </div>
  );
  const memMax = Math.min(LIMITS.maxMem[1], ram ? Math.max(1024, Math.floor((ram * 0.9) / 256) * 256) : 16384);
  const memPct = ram ? Math.round((draft.java.maxMemoryMb / ram) * 100) : null;
  const sliderRow = (title: string, hint: string, min: number, max: number, value: number, onPick: (v: number) => void, suffix = "") => row(title, hint, (
    <div className="flex w-48 shrink-0 items-center gap-3">
      <input type="range" aria-label={title} dir="ltr" min={min} max={max} step={1} value={value} onChange={(e) => onPick(Number(e.target.value))} className="h-2 w-full cursor-pointer" style={{ accentColor: "rgb(var(--c-accent))" }} />
      <span dir="ltr" className="w-11 shrink-0 text-end text-xs tabular-nums text-ink-muted">{value}{suffix}</span>
    </div>
  ));

  return (
    <div className={`settings-overlay fixed inset-0 z-overlay grid place-items-center bg-black/45 p-4 ${leaving ? "is-leaving" : ""}`} onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div aria-hidden className="pointer-events-none absolute inset-0 backdrop-blur-[2px]" />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={`settings-dialog ${leaving ? "is-leaving" : ""} relative flex h-[min(600px,calc(100vh-32px))] w-full max-w-3xl min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/30 backdrop-blur-3xl shadow-dialog focus:outline-none`}>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="relative flex min-h-10 items-center gap-3 px-5 pt-4 box-content">
            <h1 id={titleId} className="text-base font-semibold tracking-tight">{t("settings.title")}</h1>
            <nav aria-label={t("settings.sections")} className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-white/[0.06] p-1">
              {SECTIONS.map(({ id, labelKey, icon: Icon }) => (
                <button key={id} type="button" aria-current={section === id ? "true" : undefined} onClick={() => setSection(id)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors ${section === id ? "bg-control-active text-ink shadow-sm" : "text-ink-muted hover:bg-white/5 hover:text-ink"}`}>
                  <Icon size={15} aria-hidden /><span>{t(labelKey)}</span>
                </button>
              ))}
            </nav>
            <button type="button" aria-label={t("settings.reset")} title={t("settings.reset")} onClick={() => setResetting(true)} className="ms-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-raised text-ink-muted hover:text-ink"><RefreshCw size={15} aria-hidden /></button>
            <button type="button" aria-label={t("settings.close")} title={t("settings.close")} onClick={requestClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-raised text-ink-muted hover:text-ink"><X size={16} aria-hidden /></button>
          </div>
          <div className={`min-h-0 min-w-0 flex-1 overflow-y-auto px-5 pt-3 ${dirty || saveErr ? "pb-24" : "pb-4"}`}>
            <p className="mb-3 text-xs text-ink-muted">{t(current.hintKey)}</p>
            <div className="flex flex-col gap-3">
              {section === "general" && (<>
                {sectionCard(t("settings.languageSection"), (
                  <div className="flex flex-col gap-4 text-sm">
                    {row(t("settings.languageRow"), t("settings.languageRowHint"), segmented(t("settings.languageRow"), draft.appearance.language, [{ value: "en", label: "English" }, { value: "fa", label: "فارسی" }], (v) => set("appearance", { ...draft.appearance, language: v })))}
                    {row(t("settings.direction"), t("settings.directionHint"), segmented(t("settings.direction"), draft.appearance.direction, [{ value: "ltr", label: t("settings.direction.ltr") }, { value: "rtl", label: t("settings.direction.rtl") }], (v) => set("appearance", { ...draft.appearance, direction: v })))}
                  </div>
                ))}
              </>)}

              {section === "appearance" && (<>
              {sectionCard(t("settings.appearance"), (
                <div className="flex flex-col gap-4 text-sm">
                  <div role="radiogroup" aria-label={t("settings.accent")} className="flex flex-col gap-2">
                    <span className="font-medium">{t("settings.accent")}</span>
                    <div className="flex flex-wrap gap-2">
                      {ACCENTS.map((c) => {
                        const on = draft.appearance.accent === c.id;
                        return (
                          <button key={c.id} type="button" role="radio" aria-checked={on} onClick={() => set("appearance", { ...draft.appearance, accent: c.id })}
                            className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors ${on ? "border-accent bg-raised text-ink" : "border-line bg-panel text-ink-muted hover:border-accent/40 hover:text-ink"}`}>
                            <span className="grid h-5 w-5 place-items-center rounded-full ring-1 ring-white/20" style={{ backgroundColor: `rgb(${c.rgb})` }}>{on && <Check size={12} strokeWidth={2.4} className="text-black" aria-hidden />}</span>
                            {t(c.labelKey)}
                          </button>
                        );
                      })}
                    </div>
                    <span className="text-xs text-ink-muted">{t("settings.accent.hint")}</span>
                  </div>
                  {row(t("settings.dynamicAccent"), t("settings.dynamicAccentHint"), <Toggle label={t("settings.dynamicAccent")} checked={draft.appearance.dynamicAccent} onChange={(v) => set("appearance", { ...draft.appearance, dynamicAccent: v })} />)}
                  {row(t("settings.reducedMotion"), t("settings.reducedMotionHint"), <Toggle label={t("settings.reducedMotion")} checked={draft.appearance.reducedMotion} onChange={(v) => set("appearance", { ...draft.appearance, reducedMotion: v })} />)}
                  {row(t("settings.theme"), t("settings.themeHint"), segmented(t("settings.theme"), draft.appearance.theme, [{ value: "dark", label: t("settings.theme.dark") }, { value: "light", label: t("settings.theme.light") }], (v) => set("appearance", { ...draft.appearance, theme: v })))}
                </div>
              ))}
              {sectionCard(t("settings.layout"), (
                <div className="flex flex-col gap-4 text-sm">
                  {sliderRow(t("settings.cornerRadius"), t("settings.cornerRadiusHint"), 0, 30, draft.appearance.cornerRadius, (v) => set("appearance", { ...draft.appearance, cornerRadius: v }))}
                  {sliderRow(t("settings.opacity"), t("settings.opacityHint"), 50, 100, draft.appearance.opacity, (v) => set("appearance", { ...draft.appearance, opacity: v }), "%")}
                </div>
              ))}
              </>)}

              {section === "game" && (<>
                {sectionCard(t("settings.memory"), (
                  <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={t("settings.memoryMax")} hint={ram ? t("settings.ram", { ram: mb(ram) }) : undefined} error={errs.maxMem}>
                        <input className={fieldCls} dir="ltr" type="number" min={LIMITS.maxMem[0]} max={LIMITS.maxMem[1]} step={256} value={Number.isFinite(draft.java.maxMemoryMb) ? draft.java.maxMemoryMb : ""} onChange={(e) => set("java", { ...draft.java, maxMemoryMb: Number(e.target.value) })} />
                      </Field>
                      <Field label={t("settings.memoryMin")} error={errs.minMem}>
                        <input className={fieldCls} dir="ltr" type="number" min={LIMITS.minMem[0]} step={256} value={Number.isFinite(draft.java.minMemoryMb) ? draft.java.minMemoryMb : ""} onChange={(e) => set("java", { ...draft.java, minMemoryMb: Number(e.target.value) })} />
                      </Field>
                    </div>
                    <div className="flex flex-col gap-2">
                      <input type="range" aria-label={t("settings.memory.slider")} dir="ltr" min={LIMITS.maxMem[0]} max={memMax} step={256}
                        value={Math.min(Math.max(Number.isFinite(draft.java.maxMemoryMb) ? draft.java.maxMemoryMb : LIMITS.maxMem[0], LIMITS.maxMem[0]), memMax)}
                        onChange={(e) => set("java", { ...draft.java, maxMemoryMb: Number(e.target.value), minMemoryMb: Math.min(draft.java.minMemoryMb, Number(e.target.value)) })}
                        className="h-2 w-full cursor-pointer" style={{ accentColor: "rgb(var(--c-accent))" }} />
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-ink-muted">{t("settings.memory.presets")}</span>
                        {MEM_PRESETS.filter((v) => v <= memMax).map((v) => (
                          <button key={v} type="button" aria-pressed={draft.java.maxMemoryMb === v} onClick={() => set("java", { ...draft.java, maxMemoryMb: v, minMemoryMb: Math.min(draft.java.minMemoryMb, v) })}
                            className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${draft.java.maxMemoryMb === v ? "border-accent bg-raised text-ink" : "border-line text-ink-muted hover:border-accent/40 hover:text-ink"}`}>{mb(v)}</button>
                        ))}
                        {memPct !== null && <span dir="ltr" className="ms-auto text-xs text-ink-muted">{t("settings.memory.usage", { pct: memPct })}</span>}
                      </div>
                    </div>
                    {memWarn && <p className="flex items-center gap-2 text-xs text-warn"><AlertTriangle size={14} aria-hidden />{t("settings.memoryWarn")}</p>}
                    <p className="text-xs text-ink-muted" dir="ltr">{t("settings.javaDetected", { list: java.map((j) => `Java ${j.major}`).join(" · ") })}</p>
                    <Field label={t("settings.jvmArgs")} hint={t("settings.jvmArgsHint")}>
                      <textarea className={`${fieldCls} h-20 resize-none py-2 font-mono text-xs`} dir="ltr" spellCheck={false} placeholder="-XX:+UseG1GC -Dfile.encoding=UTF-8" value={draft.java.jvmArgs} onChange={(e) => set("java", { ...draft.java, jvmArgs: e.target.value })} />
                    </Field>
                  </div>
                ))}
                {sectionCard(t("settings.mobile"), (
                  <div className="flex flex-col gap-4 text-sm">
                    {row(t("settings.renderer"), t("settings.rendererHint"), segmented(t("settings.renderer"), ctl.renderer, [{ value: "Holy GL4ES", label: "Holy GL4ES" }, { value: "LTW", label: "LTW" }], (v) => ctl.setRenderer(v as "Holy GL4ES" | "LTW")))}
                    {sliderRow(t("settings.resScale"), t("settings.resScaleHint"), 25, 100, ctl.resScale, ctl.setResScale, "%")}
                    {sliderRow(t("settings.guiScale"), t("settings.guiScaleHint"), 0, 4, ctl.guiScale, ctl.setGuiScale)}
                    {row(t("settings.menuMode"), t("settings.menuModeHint"), <Toggle label={t("settings.menuMode")} checked={ctl.menuMode} onChange={ctl.setMenuMode} />)}
                    {row(t("settings.hideControls"), t("settings.hideControlsHint"), <Toggle label={t("settings.hideControls")} checked={ctl.hideOnScreenUI} onChange={ctl.setHide} />)}
                  </div>
                ))}
                {sectionCard(t("settings.defaults"), (
                  <div className="flex flex-col gap-4 text-sm">
                    {row(t("settings.defaultLoader"), t("settings.defaultLoaderHint"), segmented(t("settings.defaultLoader"), draft.minecraft.defaultLoader, (["vanilla", "fabric", "quilt"] as const).map((l) => ({ value: l, label: t(`loader.${l}`) })), (v) => set("minecraft", { ...draft.minecraft, defaultLoader: v })))}
                    {row(t("settings.preferredChannel"), t("settings.preferredChannelHint"), segmented(t("settings.preferredChannel"), draft.minecraft.preferredChannel, [{ value: "release", label: t("settings.channel.release") }, { value: "snapshot", label: t("settings.channel.snapshot") }], (v) => set("minecraft", { ...draft.minecraft, preferredChannel: v })))}
                  </div>
                ))}
                {sectionCard(t("settings.minecraft"), (
                  <div className="flex flex-col gap-4 text-sm">
                    {row(t("versions.showSnapshots"), undefined, <Toggle label={t("versions.showSnapshots")} checked={draft.minecraft.showSnapshots} onChange={(v) => set("minecraft", { ...draft.minecraft, showSnapshots: v })} />)}
                    {row(t("versions.showOldBeta"), undefined, <Toggle label={t("versions.showOldBeta")} checked={draft.minecraft.showOldBeta} onChange={(v) => set("minecraft", { ...draft.minecraft, showOldBeta: v })} />)}
                    {row(t("versions.showOldAlpha"), undefined, <Toggle label={t("versions.showOldAlpha")} checked={draft.minecraft.showOldAlpha} onChange={(v) => set("minecraft", { ...draft.minecraft, showOldAlpha: v })} />)}
                  </div>
                ))}
              </>)}

              {section === "advanced" && (<>
                {sectionCard(t("settings.downloads"), (
                  <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                    <Field label={t("settings.concurrency")} hint={t("common.rangeError", { min: 1, max: 32 })} error={errs.concurrency}>
                      <input className={fieldCls} dir="ltr" type="number" min={1} max={32} value={Number.isFinite(draft.downloads.concurrency) ? draft.downloads.concurrency : ""} onChange={(e) => set("downloads", { ...draft.downloads, concurrency: Number(e.target.value) })} />
                    </Field>
                    <Field label={t("settings.retries")} hint={t("common.rangeError", { min: 0, max: 10 })} error={errs.retries}>
                      <input className={fieldCls} dir="ltr" type="number" min={0} max={10} value={Number.isFinite(draft.downloads.retries) ? draft.downloads.retries : ""} onChange={(e) => set("downloads", { ...draft.downloads, retries: Number(e.target.value) })} />
                    </Field>
                  </div>
                ))}
                {sectionCard(t("settings.cache"), (
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span dir="ltr" className="text-ink-muted">{cache ? t("settings.cacheSize", { size: mb(cache.bytes / 1_048_576) }) : "—"}</span>
                    <Btn variant="danger" onClick={() => setConfirmCache(true)}>{t("settings.cacheClear")}</Btn>
                  </div>
                ))}
                {sectionCard(t("settings.diagnostics"), (
                  <div className="flex flex-col gap-3 text-sm">
                    <div className="flex flex-wrap gap-2">
                      <Btn onClick={() => void doReport()}><Copy size={14} aria-hidden />{t("settings.copyReport")}</Btn>
                    </div>
                    {info && <p className="text-xs text-ink-muted" dir="ltr">{t("settings.appVersion", { version: info.version, os: info.os, arch: info.arch })}</p>}
                    {info?.dataDir && <p className="break-all text-xs text-ink-faint" dir="ltr"><span className="text-ink-muted">{t("settings.dataFolder")}: </span>{info.dataDir}</p>}
                    {info?.settingsWarning && <p role="alert" className="text-xs text-danger">{t("settings.settingsWarning", { detail: info.settingsWarning })}</p>}
                    {report && <pre dir="ltr" className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-2 text-[0.6875rem] text-ink-muted">{report}</pre>}
                  </div>
                ))}
                {sectionCard(t("settings.maintenance"), (
                  <div className="flex flex-col gap-4 text-sm">
                    {row(t("settings.resetSettings"), t("settings.resetSettingsHint"), <Btn variant="danger" onClick={() => setResetting(true)}>{t("settings.resetSettings")}</Btn>)}
                  </div>
                ))}
              </>)}

            </div>
          </div>
        </div>
        {(dirty || saveErr) && (
          <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 flex justify-center">
          <div role="region" aria-label={t("settings.unsaved")} className="settings-savebar pointer-events-auto flex max-w-full items-center gap-3 rounded-full border border-white/10 bg-black/30 py-2 pe-2 ps-5 backdrop-blur-3xl">
            {saveErr
              ? <span role="alert" className="text-sm text-danger">{saveErr}</span>
              : <span className="whitespace-nowrap text-sm text-ink-muted">{t("settings.unsaved")}</span>}
            <button type="button" disabled={saving} onClick={() => { setDraft(settings); setSaveErr(null); }} className="rounded-full px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-white/10 disabled:opacity-40">{t("common.cancel")}</button>
            <button type="button" disabled={!dirty || saving} onClick={() => void save()} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40">{saving ? t("common.saving") : t("settings.saveChanges")}</button>
          </div>
          </div>
        )}
      </div>

      {confirmCache && (
        <ConfirmDialog title={t("settings.cacheConfirmTitle")} body={t("settings.cacheConfirm")} confirmLabel={t("settings.cacheClear")} busy={clearingCache}
          onCancel={() => setConfirmCache(false)} onConfirm={() => void clearCache()} />
      )}
      {resetting && (
        <ConfirmDialog title={t("settings.resetTitle")} body={t("settings.resetBody")} confirmLabel={t("settings.reset")}
          onCancel={() => setResetting(false)} onConfirm={() => void doReset()} />
      )}
      {discarding && (
        <Modal title={t("settings.discardTitle")} onClose={() => setDiscarding(false)}>
          <div className="flex flex-col gap-5">
            <p className="text-sm text-ink-muted">{t("settings.discardBody")}</p>
            <div className="flex justify-end gap-2">
              <Btn onClick={() => setDiscarding(false)}>{t("settings.keepEditing")}</Btn>
              <Btn variant="danger" onClick={discardAndClose}>{t("settings.discard")}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
