import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../store/app";
import { Btn, Field, inputCls, Modal, Toggle, useDialog } from "../components/ui";
import { api } from "../services/tauri";
import type { Instance, InstanceDraft, LoaderKind } from "../types/api";
import {
  Archive, Check, ChevronDown, Clock3, Copy, Import, ChevronUp, Info, LayoutGrid, X, List, MoreHorizontal, Package, Pencil, Play, Plus, RefreshCw, Search, Star, Trash2,
} from "../components/icons";
import { MinecraftBlock } from "../components/MinecraftBlock";
import { useI18n } from "../i18n/useI18n";
import { describeError } from "../i18n/errors";
import type { Key } from "../i18n";

type SortKey = "recent" | "name" | "mostPlayed" | "newest";
const SORT_KEY: Record<SortKey, Key> = { recent: "instances.sort.recent", name: "instances.sort.name", mostPlayed: "instances.sort.mostPlayed", newest: "instances.sort.newest" };
const SORTS = Object.keys(SORT_KEY) as SortKey[];
const LOADERS_FORM: LoaderKind[] = ["fabric", "quilt", "vanilla"]; // Forge/NeoForge need a second JVM for their installer, which Android cannot host

const emptyDraft = (version: string): InstanceDraft => ({
  name: "", versionId: version, loader: "vanilla", loaderVersion: null, maxMemoryMb: null,
  javaPath: null, jvmArgs: [], resolution: null, fullscreen: null, starModEnabled: false,
});
const draftOf = (i: Instance): InstanceDraft => ({
  name: i.name, versionId: i.versionId, loader: i.loader, loaderVersion: i.loaderVersion, maxMemoryMb: i.maxMemoryMb,
  javaPath: i.javaPath, jvmArgs: i.jvmArgs, resolution: i.resolution, fullscreen: i.fullscreen, starModEnabled: i.starModEnabled,
});
const starSupported = (d: InstanceDraft) => d.loader === "fabric" && d.versionId === "1.21.1";
const MEM_MIN = 512, MEM_MAX = 65536;
type GameType = "release" | "snapshot";
const SNAPSHOT_CATS = ["snapshot", "pre_release", "release_candidate"];
const LEGACY_CATS = ["old_beta", "old_alpha"];
const playtime = (secs: number) => {
  const total = Math.max(0, Math.floor(secs));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

export function Instances() {
  const { t, count, lang } = useI18n();
  const errorText = (e: unknown) => describeError(lang, e);
  const { instances, selectedVersion, versions, settings, favoritesOnly, refreshInstances, toast, selectedInstance, running, createRequest } = useApp();
  const [draft, setDraft] = useState<InstanceDraft>(() => emptyDraft(selectedVersion ?? ""));
  const [editing, setEditing] = useState<Instance | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [loadingLoaders, setLoadingLoaders] = useState(false);
  const [bundledHudVersions, setBundledHudVersions] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<Instance | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>(() => readSort());
  const [sortOpen, setSortOpen] = useState(false);
  const [grid, setGrid] = useState(() => localStorage.getItem("star.instances.view") === "grid");
  const [refreshing, setRefreshing] = useState(false);
  const [menu, setMenu] = useState<{ inst: Instance; left: number; top: number } | null>(null);
  const seenCreate = useRef(createRequest);
  const [nameTouched, setNameTouched] = useState(false);
  const [nameManual, setNameManual] = useState(false);
  const [gameType, setGameType] = useState<GameType>("release");
  const [legacyMode, setLegacyMode] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.starBundled().then(setBundledHudVersions).catch(() => setBundledHudVersions([])); }, []);
  useEffect(() => { localStorage.setItem("star.instances.sort", sort); }, [sort]);
  useEffect(() => { localStorage.setItem("star.instances.view", grid ? "grid" : "list"); }, [grid]);
  // Versions page asks us to open the create form.
  useEffect(() => {
    if (createRequest !== seenCreate.current) { seenCreate.current = createRequest; openCreate(); }
  }, [createRequest]);
  useEffect(() => {
    if (!menu && !sortOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(null); setSortOpen(false); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu, sortOpen]);

  const isRunning = (id: string) => running.some((g) => g.instanceId === id);

  const loadLoaders = async (loader: LoaderKind, mc: string) => {
    setFormError(null);
    if (loader === "vanilla" || !mc) { setLoaderVersions([]); return; }
    setLoadingLoaders(true);
    try {
      const c = await api.loaderCompat(loader, mc);
      setLoaderVersions(c.versions.map((v) => v.version));
      const first = c.versions.find((v) => v.stable)?.version ?? c.versions[0]?.version ?? null;
      if (first) setDraft((d) => (d.loaderVersion ? d : { ...d, loaderVersion: first }));
      if (!c.compatible || !c.installable) setFormError(c.reason ?? t("instances.form.loaderUnavailable"));
    } catch (e) { setFormError(errorText(e)); }
    finally { setLoadingLoaders(false); }
  };

  const openCreate = () => {
    setEditing(null);
    const wantSnapshot = settings?.minecraft.preferredChannel === "snapshot" && !!versions?.latestSnapshot;
    const start = selectedVersion ?? (wantSnapshot ? versions?.latestSnapshot : versions?.latestRelease) ?? "";
    const dl = settings?.minecraft.defaultLoader ?? "vanilla";
    setDraft({ ...emptyDraft(start), loader: dl });
    setGameType(typeOf(start));
    setLoaderVersions([]); setFormError(null); setNameTouched(false); setNameManual(false); setLegacyMode(false); setFormOpen(true);
    if (dl !== "vanilla") void loadLoaders(dl, start);
  };
  const openEdit = (i: Instance) => { setEditing(i); setDraft(draftOf(i)); setGameType(typeOf(i.versionId)); setFormError(null); setNameTouched(false); setNameManual(true); setLegacyMode(isLegacyVersion(i.versionId)); setFormOpen(true); void loadLoaders(i.loader, i.versionId); };

  const typeOf = (id: string): GameType => {
    const row = versions?.versions.find((v) => v.id === id);
    return row && SNAPSHOT_CATS.includes(row.category) ? "snapshot" : "release";
  };
  const isLegacyVersion = (id: string) => {
    const row = versions?.versions.find((v) => v.id === id);
    return !!row && LEGACY_CATS.includes(row.category);
  };
  // Version ids for a Game Type; Legacy Mode switches the list to the old Beta/Alpha versions.
  const idsFor = (type: GameType, legacy: boolean): string[] => {
    if (!versions) return [];
    const want = (c: string) => (legacy ? LEGACY_CATS.includes(c) : type === "snapshot" ? SNAPSHOT_CATS.includes(c) : c === "release");
    return versions.versions.filter((v) => want(v.category)).sort((a, b) => (Date.parse(b.releaseTime) || 0) - (Date.parse(a.releaseTime) || 0)).map((v) => v.id);
  };
  const versionsOfType = useMemo(() => idsFor(gameType, legacyMode), [versions, gameType, legacyMode]);
  const versionOptions = versionsOfType.includes(draft.versionId) || !draft.versionId ? versionsOfType : [draft.versionId, ...versionsOfType];

  // New instances are named "<Loader>-<version>" until the user types their own name.
  useEffect(() => {
    if (!formOpen || editing || nameManual) return;
    setDraft((d) => {
      const auto = d.versionId ? `${t(`loader.${d.loader}`)}-${d.versionId}` : "";
      return d.name === auto ? d : { ...d, name: auto };
    });
  }, [formOpen, editing, nameManual, draft.loader, draft.versionId]);

  const toggleLegacy = (on: boolean) => {
    setLegacyMode(on);
    const first = idsFor(gameType, on)[0] ?? "";
    setDraft((d) => ({ ...d, versionId: first, loaderVersion: null }));
    setLoaderVersions([]); void loadLoaders(draft.loader, first);
  };

  const nameError = draft.name.trim() ? null : t("instances.form.nameRequired");
  const memError = draft.maxMemoryMb !== null && (draft.maxMemoryMb < MEM_MIN || draft.maxMemoryMb > MEM_MAX)
    ? t("common.rangeError", { min: MEM_MIN, max: MEM_MAX }) : null;
  const loaderError = draft.loader !== "vanilla" && !draft.loaderVersion ? t("instances.form.loaderVersionRequired") : null;
  const canSave = !nameError && !memError && !loaderError && !!draft.versionId && busy !== "form";

  const submit = async () => {
    if (!canSave) return;
    setFormError(null);
    setBusy("form");
    try {
      const saved = editing ? await api.updateInstance(editing.id, draft) : await api.createInstance(draft);
      await refreshInstances();
      useApp.setState({ selectedInstance: saved.id });
      toast("info", { key: editing ? "instances.updated" : "instances.created", params: { name: saved.name } });
      setFormOpen(false);
    } catch (e) { setFormError(errorText(e)); }
    finally { setBusy(null); }
  };

  const doDelete = async () => {
    if (!deleting) return;
    setBusy("delete");
    try {
      await api.deleteInstance(deleting.id, confirmName, true);
      toast("info", { key: "instances.delete.done", params: { name: deleting.name } });
      if (selectedInstance === deleting.id) useApp.setState({ selectedInstance: null });
      setDeleting(null); setConfirmName("");
      await refreshInstances();
    } catch (e) { toast("error", { error: e }); }
    finally { setBusy(null); }
  };

  const run = async (label: string, fn: () => Promise<unknown>, done?: { key: Key; params?: Record<string, string | number> }) => {
    setMenu(null);
    setBusy(label);
    try { await fn(); if (done) toast("info", done); }
    catch (e) { toast("error", { error: e }); }
    finally { setBusy(null); }
  };

  const quickPlay = (i: Instance) => { setMenu(null); useApp.setState({ selectedInstance: i.id, pendingLaunch: i.id, page: "home" }); };
  const select = (i: Instance) => useApp.setState({ selectedInstance: i.id });
  const play = (i: Instance) => useApp.setState({ selectedInstance: i.id, pendingLaunch: i.id, page: "home" });

  const fileRef = useRef<HTMLInputElement>(null);
  const importArchive = () => fileRef.current?.click();
  const onPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    await run("import", async () => { const i = await api.importInstance(f); await refreshInstances(); useApp.setState({ selectedInstance: i.id }); }, { key: "instances.imported" });
  };

  const refresh = async () => { setRefreshing(true); try { await refreshInstances(); } catch (e) { toast("error", { error: e }); } finally { setRefreshing(false); } };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = instances.filter((i) => (!favoritesOnly || i.favorite) && (!q || `${i.name} ${i.versionId} ${i.loader} ${i.loaderVersion ?? ""}`.toLowerCase().includes(q)));
    const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
    const by: Record<SortKey, (a: Instance, b: Instance) => number> = {
      recent: (a, b) => (b.lastPlayed ?? "").localeCompare(a.lastPlayed ?? "") || b.createdAt.localeCompare(a.createdAt),
      name: (a, b) => collator.compare(a.name, b.name),
      mostPlayed: (a, b) => b.playCount - a.playCount || b.playtimeSecs - a.playtimeSecs,
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
    };
    return [...list].sort((a, b) => Number(b.favorite) - Number(a.favorite) || by[sort](a, b));
  }, [instances, query, sort, lang, favoritesOnly]);

  const totals = useMemo(() => instances.reduce((acc, i) => ({ plays: acc.plays + i.playCount, secs: acc.secs + i.playtimeSecs }), { plays: 0, secs: 0 }), [instances]);

  const openMenu = (i: Instance, el: HTMLElement) => {
    if (menu?.inst.id === i.id) return setMenu(null);
    const r = el.getBoundingClientRect();
    const width = 288, height = Math.min(516, window.innerHeight - 24);
    const fitsBelow = r.bottom + 6 + height <= window.innerHeight - 12;
    const top = fitsBelow ? r.bottom + 6 : Math.max(12, r.top - 6 - height);
    setMenu({ inst: i, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)), top });
  };

  const actions = (i: Instance) => {
    const selected = i.id === selectedInstance;
    const runningHere = isRunning(i.id);
    return (
      <div className="flex items-center gap-2">
        <button type="button" aria-label={t("instances.action.more", { name: i.name })} aria-haspopup="menu" aria-expanded={menu?.inst.id === i.id} onClick={(e) => openMenu(i, e.currentTarget)}
          className={`grid h-9 w-9 place-items-center rounded-full transition-colors focus-visible:outline-accent ${menu?.inst.id === i.id ? "bg-control-active text-ink" : "text-ink hover:bg-white/5"}`}><MoreHorizontal size={17} aria-hidden /></button>
        <button type="button" aria-label={t("instances.action.edit", { name: i.name })} title={t("instances.action.edit", { name: i.name })} onClick={() => openEdit(i)} disabled={runningHere}
          className="grid h-9 w-9 place-items-center rounded-full text-ink transition-colors hover:bg-white/5 disabled:opacity-40 focus-visible:outline-accent"><Pencil size={15} aria-hidden /></button>
        <button type="button" onClick={() => (selected ? play(i) : select(i))} disabled={runningHere}
          className={`h-9 w-[7rem] rounded-lg bg-control text-sm font-semibold transition-colors hover:bg-control-hover disabled:opacity-50 ${selected ? "text-accent" : "text-ink"}`}>
          {runningHere ? t("instances.action.running") : selected ? t("instances.action.play") : t("instances.action.select")}
        </button>
      </div>
    );
  };

  const meta = (i: Instance) => (
    <>
      <Chip>{t(`loader.${i.loader}`)}</Chip>
      <Chip>{i.versionId}</Chip>
      {i.loaderVersion && <Chip>{i.loaderVersion}</Chip>}
    </>
  );

  const menuItem = (inst: Instance) => (
    <div role="menu" aria-label={inst.name} style={{ left: menu?.left, top: menu?.top }} className="menu-pop absolute max-h-[32.25rem] w-72 overflow-y-auto rounded-2xl border border-line bg-raised p-1.5 shadow-pop" onMouseDown={(e) => e.stopPropagation()}>
      <MenuItem icon={<Play size={16} aria-hidden />} title={t("instances.menu.quickPlay")} hint={t("instances.menu.quickPlayHint")} onClick={() => quickPlay(inst)} disabled={isRunning(inst.id)} />
      <MenuItem icon={<Star size={16} aria-hidden className="fill-current" />} title={inst.favorite ? t("instances.menu.favoriteRemove") : t("instances.menu.favoriteAdd")} hint={t("instances.menu.favoriteHint")}
        onClick={() => run("fav", async () => { await api.setInstanceFavorite(inst.id, !inst.favorite); await refreshInstances(); })} />
      <MenuItem icon={<Package size={16} aria-hidden />} title={t("instances.menu.modrinth")} hint={t("instances.menu.modrinthHint")}
        onClick={() => { setMenu(null); useApp.setState({ selectedInstance: inst.id, modsView: "discover", page: "mods" }); }} />
      <Divider />
      <MenuItem icon={<Copy size={16} aria-hidden />} title={t("instances.menu.duplicate")} hint={t("instances.menu.duplicateHint")} disabled={isRunning(inst.id)}
        onClick={() => run("dup", async () => { const c = await api.duplicateInstance(inst.id, t("instances.copySuffix")); await refreshInstances(); useApp.setState({ selectedInstance: c.id }); }, { key: "instances.duplicated", params: { name: inst.name } })} />
      <MenuItem icon={<Archive size={16} aria-hidden />} title={t("instances.menu.export")} hint={t("instances.menu.exportHint", { loader: t(`loader.${inst.loader}`) })} disabled={isRunning(inst.id)}
        onClick={() => run("export", async () => { await api.exportInstance(inst.id); }, { key: "instances.exported" })} />
      <Divider />
      <MenuItem danger icon={<Trash2 size={16} aria-hidden />} title={t("instances.menu.delete")} hint={t("instances.menu.deleteHint")} disabled={isRunning(inst.id)}
        onClick={() => { setDeleting(inst); setConfirmName(""); setMenu(null); }} />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <section aria-labelledby="instances-title" className="flex min-h-0 flex-1 flex-col gap-4 rounded-2xl bg-panel p-4">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 id="instances-title" className="text-lg font-semibold">{favoritesOnly ? t("instances.favoritesTitle") : t("instances.title")}</h1>
            {favoritesOnly
              ? <button type="button" onClick={() => useApp.setState({ favoritesOnly: false })} className="text-sm text-accent hover:underline">{t("instances.showAll")}</button>
              : <p className="text-sm text-ink-muted">{t("instances.subtitle")}</p>}
          </div>
          <div className="flex gap-2">
            <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => void onPicked(e)} />
            <button type="button" onClick={() => importArchive()} disabled={busy === "import"} className={`inline-flex h-10 items-center gap-2 rounded-xl bg-control px-4 text-sm font-semibold text-accent transition-colors hover:bg-control-hover disabled:opacity-50`}>
              <Import size={16} aria-hidden />{busy === "import" ? t("instances.importing") : t("instances.import")}
            </button>
            <button type="button" onClick={openCreate} className={`inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-accent-ink transition-colors bg-accent hover:bg-accent-hover`}><Plus size={16} aria-hidden />{t("instances.create")}</button>
          </div>
        </header>

        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{t("instances.searchLabel")}</span>
            <Search size={16} aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input type="search" placeholder={t("instances.searchPlaceholder")} className="h-10 w-full rounded-xl bg-control ps-10 pe-3 text-sm text-ink placeholder:text-ink-faint outline-none focus-visible:ring-2 focus-visible:ring-accent/60" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="relative">
            <button type="button" aria-haspopup="listbox" aria-expanded={sortOpen} aria-label={t("instances.sortLabel")} onClick={() => setSortOpen((v) => !v)} className="flex h-10 w-44 items-center justify-between gap-2 rounded-xl bg-control px-3 text-sm text-ink transition-colors hover:bg-control-hover">
              <span className="truncate">{t(SORT_KEY[sort])}</span><ChevronDown size={16} aria-hidden className={`shrink-0 text-ink-muted transition-transform ${sortOpen ? "rotate-180" : ""}`} />
            </button>
            {sortOpen && (
              <>
                <div className="fixed inset-0 z-30" aria-hidden onMouseDown={() => setSortOpen(false)} />
                <ul role="listbox" aria-label={t("instances.sortLabel")} className="menu-pop absolute end-0 top-12 z-dropdown w-44 rounded-xl border border-line bg-raised p-1.5 shadow-pop">
                  {SORTS.map((s) => (
                    <li key={s}><button type="button" role="option" aria-selected={sort === s} onClick={() => { setSort(s); setSortOpen(false); }} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/5">{t(SORT_KEY[s])}{sort === s && <Check size={15} aria-hidden />}</button></li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <button type="button" aria-label={grid ? t("instances.viewList") : t("instances.viewGrid")} title={grid ? t("instances.viewList") : t("instances.viewGrid")} onClick={() => setGrid((v) => !v)} className="grid h-10 w-10 place-items-center rounded-xl bg-control text-ink-muted transition-colors hover:text-ink">{grid ? <List size={16} aria-hidden /> : <LayoutGrid size={16} aria-hidden />}</button>
          <button type="button" aria-label={t("instances.reload")} title={t("common.refresh")} onClick={() => void refresh()} className="grid h-10 w-10 place-items-center rounded-xl bg-control text-ink-muted transition-colors hover:text-ink"><RefreshCw size={16} aria-hidden className={refreshing ? "animate-spin" : ""} /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pe-1">
          {instances.length === 0 ? (
            <div className="grid h-full place-items-center text-center">
              <div className="flex flex-col items-center gap-3"><MinecraftBlock size="lg" /><p className="text-sm text-ink-muted">{t("instances.empty")}</p><Btn variant="primary" onClick={openCreate}><Plus size={15} aria-hidden />{t("instances.createFirst")}</Btn></div>
            </div>
          ) : visible.length === 0 ? (
            <p className="p-6 text-center text-sm text-ink-muted">{favoritesOnly && !query.trim() ? t("instances.noFavorites") : t("instances.noMatch", { query })}</p>
          ) : grid ? (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
              {visible.map((i) => (
                <li key={i.id} className={`flex flex-col gap-3 rounded-2xl border p-4 transition-colors ${i.id === selectedInstance ? "border-accent/40 bg-accent/5" : "border-transparent bg-raised hover:border-line"}`}>
                  <div className="flex items-start gap-3">
                    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-control"><MinecraftBlock size="md" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5"><span className="truncate font-semibold">{i.name}</span>{i.favorite && <Star size={13} aria-label={t("instances.favorite")} className="shrink-0 fill-accent text-accent" />}</div>
                      <div className="mt-1 flex flex-wrap gap-1">{meta(i)}</div>
                    </div>
                  </div>
                  <div className="flex gap-6"><Stat icon={<Play size={13} aria-hidden />} value={count(i.playCount)} label={t("instances.stat.launches")} /><Stat icon={<Clock3 size={13} aria-hidden />} value={playtime(i.playtimeSecs)} label={t("instances.stat.playtime")} /></div>
                  {actions(i)}
                </li>
              ))}
            </ul>
          ) : (
            <ul className="flex flex-col gap-3.5">
              {visible.map((i) => (
                <li key={i.id} className="flex items-center gap-4 rounded-2xl bg-raised/70 px-3 py-3">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-control"><MinecraftBlock size="md" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[1.0625rem]">{i.name}</span>
                      {i.favorite && <Star size={13} aria-label={t("instances.favorite")} className="fill-current text-ink" />}
                      {meta(i)}
                    </div>
                    <span dir="ltr" className="block truncate text-xs text-ink-muted">{t("instances.folderName", { name: i.id })}</span>
                  </div>
                  <div className="hidden items-center md:flex">
                    <Stat icon={<Play size={13} aria-hidden />} value={count(i.playCount)} label={t("instances.stat.launches")} />
                    <span className="mx-4 h-9 w-px bg-line" aria-hidden />
                    <Stat icon={<Clock3 size={13} aria-hidden />} value={playtime(i.playtimeSecs)} label={t("instances.stat.playtime")} />
                  </div>
                  <div className="ms-4">{actions(i)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <footer className="grid grid-cols-2 rounded-2xl bg-panel py-3 text-sm text-ink-muted">
        <span className="flex items-center justify-center gap-2"><Play size={15} aria-hidden />{t("instances.totals.launches", { count: totals.plays })}</span>
        <span className="flex items-center justify-center gap-2"><Clock3 size={15} aria-hidden />{t("instances.totals.playtime", { time: playtime(totals.secs) })}</span>
      </footer>

      {menu && createPortal(
        <div className="fixed inset-0 z-40" onMouseDown={() => setMenu(null)}>
          {menuItem(menu.inst)}
        </div>,
        document.body,
      )}

      {formOpen && (
        <FormDialog title={editing ? t("instances.form.editTitle", { name: editing.name }) : t("instances.form.createTitle")} onClose={() => setFormOpen(false)} closeLabel={t("dialog.close")} dialogRef={dialogRef}>
          <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
            <div className="flex items-end gap-4">
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-control"><MinecraftBlock size="md" /></div>
              <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
                <span className="font-semibold">{t("instances.form.name")}<span className="text-danger" aria-hidden>*</span></span>
                <input className="h-10 w-full rounded-xl bg-control px-3.5 text-sm text-ink placeholder:text-ink-faint outline-none focus-visible:ring-2 focus-visible:ring-accent aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-danger" maxLength={48} placeholder={t("instances.form.namePlaceholder")} value={draft.name}
                  aria-invalid={nameTouched && nameError ? true : undefined}
                  onBlur={() => setNameTouched(true)} onChange={(e) => { setNameManual(true); setDraft({ ...draft, name: e.target.value }); }} />
              </label>
            </div>
            {nameTouched && nameError && <p role="alert" className="-mt-3 text-xs text-danger">{nameError}</p>}

            <div className="grid grid-cols-2 gap-4">
              <FormSelect label={t("instances.form.loader")} value={draft.loader} options={LOADERS_FORM.map((l) => ({ value: l, label: t(`loader.${l}`) }))}
                onChange={(v) => { const l = v as LoaderKind; setDraft({ ...draft, loader: l, loaderVersion: null, starModEnabled: l === "fabric" && draft.starModEnabled }); setLoaderVersions([]); void loadLoaders(l, draft.versionId); }} />
              <FormSelect label={t("instances.form.gameType")} value={gameType} options={[{ value: "snapshot", label: t("instances.form.type.snapshot") }, { value: "release", label: t("instances.form.type.release") }]}
                onChange={(v) => {
                  const next = v as GameType;
                  setGameType(next);
                  setLegacyMode(false);
                  const first = idsFor(next, false)[0] ?? "";
                  setDraft({ ...draft, versionId: first, loaderVersion: null });
                  setLoaderVersions([]); void loadLoaders(draft.loader, first);
                }} />
              <FormSelect label={t("instances.form.version")} value={draft.versionId} mono options={versionOptions.map((v) => ({ value: v, label: v }))}
                onChange={(v) => { setDraft({ ...draft, versionId: v, loaderVersion: null }); setLoaderVersions([]); void loadLoaders(draft.loader, v); }} />
              {draft.loader !== "vanilla" && (
                <FormSelect label={t("instances.form.loaderVersion")} value={draft.loaderVersion ?? ""} mono disabled={loadingLoaders} placeholder={loadingLoaders ? t("instances.form.loaderLoading") : t("instances.form.loaderVersionPick")}
                  options={loaderVersions.map((v) => ({ value: v, label: v.startsWith(`${draft.versionId}-`) ? v.slice(draft.versionId.length + 1) : v }))} onChange={(v) => setDraft({ ...draft, loaderVersion: v || null })} />
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm font-semibold">
                <input type="checkbox" checked={legacyMode} onChange={(e) => toggleLegacy(e.target.checked)} className="peer sr-only" />
                <span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center rounded border border-ink-faint bg-control peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60">{legacyMode && <Check size={12} strokeWidth={3} className="text-accent-ink" />}</span>
                <span>{t("instances.form.legacy")}</span>
                <Info size={15} aria-hidden className="text-ink-muted" />
              </label>
              <p className="ps-[26px] text-xs text-ink-muted">{t("instances.form.legacyHint")}</p>
            </div>

            {editing && (
              <>
                <Field label={t("instances.form.memory")} hint={t("instances.form.memoryHint")} error={memError}>
                  <input className={inputCls} dir="ltr" type="number" min={MEM_MIN} max={MEM_MAX} step={256} value={draft.maxMemoryMb ?? ""} onChange={(e) => setDraft({ ...draft, maxMemoryMb: e.target.value ? Number(e.target.value) : null })} />
                </Field>
                {starSupported(draft) && (
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      <span className="block font-medium">{t("instances.form.starHud")}</span>
                      <span className="mt-0.5 block text-xs text-ink-muted">{bundledHudVersions.includes(draft.versionId) ? t("instances.form.starHudHint") : t("hud.notBuilt")}</span>
                    </span>
                    <Toggle label={t("instances.form.starHud")} checked={draft.starModEnabled} disabled={!bundledHudVersions.includes(draft.versionId)} onChange={(v) => setDraft({ ...draft, starModEnabled: v })} />
                  </div>
                )}
              </>
            )}

            {formError && <p role="alert" className="text-xs text-danger">{formError}</p>}
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setFormOpen(false)} className="h-10 rounded-xl bg-control px-5 text-sm font-semibold text-ink transition-colors hover:bg-control-hover">{t("common.cancel")}</button>
              <button type="submit" disabled={!canSave || loadingLoaders} className="h-10 rounded-xl bg-accent px-5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40">
                {busy === "form" ? t("common.saving") : editing ? t("instances.form.saveChanges") : t("instances.form.createButton")}
              </button>
            </div>
          </form>
        </FormDialog>
      )}

      {deleting && (
        <Modal title={t("instances.delete.title")} onClose={() => setDeleting(null)}>
          <p className="mb-3 text-sm text-ink-muted">{t("instances.delete.body", { name: deleting.name })}</p>
          <label className="mb-1 block text-sm font-medium" htmlFor="confirm-delete-name">{t("instances.delete.inputLabel")}</label>
          <input id="confirm-delete-name" autoFocus className={`${inputCls} mb-4`} value={confirmName} onChange={(e) => setConfirmName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && confirmName === deleting.name) void doDelete(); }} />
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setDeleting(null)}>{t("common.cancel")}</Btn>
            <Btn variant="danger" disabled={confirmName !== deleting.name || busy === "delete"} onClick={() => void doDelete()}><Trash2 size={15} aria-hidden />{t("instances.delete.confirm")}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

function readSort(): SortKey {
  const v = localStorage.getItem("star.instances.sort");
  return (SORTS as string[]).includes(v ?? "") ? (v as SortKey) : "recent";
}

function Chip({ children }: { children: ReactNode }) {
  return <span dir="ltr" className="rounded-md bg-control px-2 py-0.5 text-[0.6875rem] font-semibold text-ink">{children}</span>;
}
function Stat({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return (
    <div className="flex min-w-[4.75rem] flex-col items-center leading-tight">
      <span className="flex items-center gap-1 text-sm font-semibold text-ink">{icon}<span dir="ltr">{value}</span></span>
      <span className="text-[0.6875rem] text-ink-muted">{label}</span>
    </div>
  );
}
function MenuItem({ icon, title, hint, onClick, disabled, danger }: { icon: ReactNode; title: string; hint: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" disabled={disabled} onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl px-3 py-2 text-start transition-colors hover:bg-white/5 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 ${danger ? "text-danger" : "text-ink"}`}>
      <span className={`mt-0.5 shrink-0 ${danger ? "" : "text-ink-muted"}`}>{icon}</span>
      <span className="min-w-0"><span className="block text-sm font-semibold">{title}</span><span className={`block text-xs ${danger ? "text-danger/80" : "text-ink-muted"}`}>{hint}</span></span>
    </button>
  );
}
const Divider = () => <div role="separator" className="mx-3 my-1 h-px bg-line" />;


function FormDialog({ title, closeLabel, onClose, dialogRef, children }: { title: string; closeLabel: string; onClose: () => void; dialogRef: RefObject<HTMLDivElement>; children: ReactNode }) {
  const titleId = useId();
  useDialog(dialogRef, onClose);
  return (
    <div className="fixed inset-0 z-overlay grid place-items-center bg-black/60 p-4" onMouseDown={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="max-h-full w-full max-w-[28rem] overflow-y-auto rounded-2xl border border-line bg-panel p-5 shadow-dialog focus:outline-none" onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <h3 id={titleId} className="text-base font-semibold">{title}</h3>
          <button type="button" aria-label={closeLabel} title={closeLabel} onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg bg-control text-ink-muted transition-colors hover:bg-control-hover hover:text-ink"><X size={16} aria-hidden /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Dropdown used by the create/edit form: opens above the field, white outline while open, check on the current choice. */
function FormSelect({ label, value, options, onChange, disabled, mono, placeholder }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; disabled?: boolean; mono?: boolean; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const current = options.find((o) => o.value === value);
  const listRef = useRef<HTMLUListElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [up, setUp] = useState(true);
  // Opens above the field when there is room inside the dialog, otherwise below it.
  useLayoutEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    if (!btn) return;
    const top = btn.closest('[role="dialog"]')?.getBoundingClientRect().top ?? 0;
    const need = Math.min(options.length * 36 + 14, 240) + 20;
    setUp(btn.getBoundingClientRect().top - top >= need);
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollIntoView({ block: "nearest" });
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open]);
  return (
    <div className="relative flex flex-col gap-1.5 text-sm">
      <span id={id} className="font-semibold">{label}<span className="text-danger" aria-hidden>*</span></span>
      <button ref={btnRef} type="button" aria-labelledby={id} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((v) => !v)} dir={mono ? "ltr" : undefined}
        className={`flex h-10 w-full items-center justify-between gap-2 rounded-xl bg-control px-3.5 text-start text-sm font-medium transition-colors hover:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50 ${open ? "ring-2 ring-accent" : ""}`}>
        <span className={`truncate ${current ? "" : "text-ink-faint"}`}>{current?.label ?? placeholder ?? ""}</span>
        {open ? <ChevronUp size={16} aria-hidden className="shrink-0" /> : <ChevronDown size={16} aria-hidden className="shrink-0" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" aria-hidden onMouseDown={() => setOpen(false)} />
          <ul ref={listRef} role="listbox" aria-labelledby={id} dir={mono ? "ltr" : undefined} className={`menu-pop absolute z-50 max-h-[11rem] w-full overflow-y-auto ${up ? "bottom-[calc(100%-26px)] mb-3" : "top-full mt-1.5"} rounded-xl border border-line bg-panel p-1.5 shadow-pop`}>
            {options.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">—</li>}
            {options.map((o) => (
              <li key={o.value}>
                <button type="button" role="option" aria-selected={o.value === value} onClick={() => { onChange(o.value); setOpen(false); }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-sm transition-colors hover:bg-white/5 ${o.value === value ? "bg-control" : ""}`}>
                  <span className="truncate">{o.label}</span>{o.value === value && <Check size={15} aria-hidden className="shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
