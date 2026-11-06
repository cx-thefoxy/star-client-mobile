import { useEffect, useMemo, useState } from "react";
import { useApp } from "../store/app";
import { Card, Btn, Pill, inputCls, Toggle, ConfirmDialog } from "../components/ui";
import { api } from "../services/tauri";
import type { ModInfo, ModrinthProject } from "../types/api";
import { Download, Heart, Search, Sparkles } from "../components/icons";
import { useI18n } from "../i18n/useI18n";

export function Mods() {
  const { t, count } = useI18n();
  const { instances, selectedInstance, toast, running, modsView } = useApp();
  const inst = instances.find((i) => i.id === selectedInstance) ?? instances[0];
  const [mods, setMods] = useState<ModInfo[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  // The Installed / Discover tab lives in the store so the rail (Mods vs. Discover) can open and highlight it.
  const discover = modsView === "discover";
  const setDiscover = (v: boolean) => useApp.setState({ modsView: v ? "discover" : "installed" });
  const [projects, setProjects] = useState<ModrinthProject[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ModInfo | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const locked = !!inst && running.some((g) => g.instanceId === inst.id);
  const errText = (e: unknown) => e instanceof Error ? e.message : String(e);

  const load = async () => {
    if (!inst) return setMods([]);
    setLoading(true);
    try { setMods(await api.listMods(inst.id)); }
    catch (e) { toast("error", { error: e }); }
    finally { setLoading(false); }
  };

  const discoverProjects = async () => {
    if (!inst) return;
    setDiscoverLoading(true);
    setDiscoverError(null);
    try { setProjects(await api.searchModrinth(query, inst.id)); }
    catch (e) { setDiscoverError(errText(e)); }
    finally { setDiscoverLoading(false); }
  };

  useEffect(() => { void load(); }, [inst?.id]);
  // Opened from the rail's globe or "Browse Modrinth" in the Instances menu: start on Discover with real results.
  useEffect(() => {
    if (discover && inst) void discoverProjects();
  }, [inst?.id, discover]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mods.filter((m) => !q || (m.name ?? m.fileName).toLowerCase().includes(q) || (m.id ?? "").toLowerCase().includes(q));
  }, [mods, query]);

  const installProject = async (project: ModrinthProject) => {
    if (!inst) return;
    setInstalling(project.id);
    try {
      const result = await api.installModrinth(inst.id, project.id);
      toast("info", { key: "mods.installed", params: { file: result.fileName } });
      await load();
    } catch (e) { toast("error", { error: e }); }
    finally { setInstalling(null); }
  };

  const toggle = async (m: ModInfo) => {
    if (!inst) return;
    try { await api.setModEnabled(inst.id, m.fileName, !m.enabled); await load(); }
    catch (e) { toast("error", { error: e }); }
  };

  const confirmRemove = async () => {
    if (!inst || !removing) return;
    setRemoveBusy(true);
    try {
      await api.removeMod(inst.id, removing.fileName);
      toast("info", { key: "mods.removed", params: { name: removing.name ?? removing.fileName } });
      setRemoving(null);
      await load();
    } catch (e) { toast("error", { error: e }); }
    finally { setRemoveBusy(false); }
  };

  if (!inst) return <div className="flex h-full min-h-0 flex-col rounded-2xl bg-panel p-4"><p className="text-sm text-ink-muted">{t("mods.noInstance")}</p></div>;

  const tabCls = (active: boolean) => `rounded-xl px-4 py-2 text-sm transition-colors ${active ? "bg-accent font-semibold text-accent-ink" : "bg-raised text-ink-muted hover:text-ink"}`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 rounded-2xl bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t("mods.tabs")} className="flex gap-1.5">
          <button type="button" aria-pressed={!discover} onClick={() => setDiscover(false)} className={tabCls(!discover)}>{t("mods.tab.installed")}</button>
          <button type="button" aria-pressed={discover} onClick={() => setDiscover(true)} className={tabCls(discover)}><Sparkles size={14} aria-hidden className="me-1 inline" />{t("mods.tab.discover")}</button>
        </div>
        <div className="relative">
          <Search size={15} aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input type="search" aria-label={t("mods.searchLabel")} className={`${inputCls} w-48 ps-9`} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={discover ? t("mods.searchPlaceholder") : t("mods.filterPlaceholder")}
            onKeyDown={(e) => { if (discover && e.key === "Enter") void discoverProjects(); }} />
        </div>
        <span dir="ltr" className="text-xs text-ink-muted">{inst.versionId} · {inst.loader}</span>
        <div className="ms-auto flex gap-2">
          <Btn onClick={load} disabled={loading}>{t("common.refresh")}</Btn>
        </div>
      </div>
      {locked && <p role="status" className="text-xs text-danger">{t("mods.locked")}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {discover ? (
          <>
            {discoverError && <p role="alert" className="mb-3 text-sm text-danger">{discoverError}</p>}
            <p className="mb-3 text-xs text-ink-muted">{t("mods.discoverHint", { version: inst.versionId, loader: t(`loader.${inst.loader}`) })}</p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {discoverLoading && [1, 2, 3].map((n) => <div key={n} className="skeleton h-56 rounded-2xl border border-line" role="status" aria-label={t("mods.loadingProjects")} />)}
              {!discoverLoading && !discoverError && projects.length === 0 && <Card><p className="text-sm text-ink-muted">{t("mods.discoverNone")}</p></Card>}
              {!discoverLoading && projects.map((project) => (
                <Card key={project.id}>
                  <div className="flex items-start gap-3">
                    {project.iconUrl ? <img src={project.iconUrl} alt="" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} className="h-12 w-12 rounded-xl bg-raised object-cover" /> : <div aria-hidden className="grid h-12 w-12 place-items-center rounded-xl bg-raised text-accent"><Sparkles size={20} /></div>}
                    <div className="min-w-0 flex-1"><h3 className="truncate font-semibold">{project.title}</h3><p className="truncate text-xs text-ink-muted" dir="ltr">{project.slug}</p></div>
                  </div>
                  <p className="mt-3 line-clamp-3 text-sm text-ink-muted">{project.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1">{project.categories.slice(0, 3).map((c) => <Pill key={c}>{c}</Pill>)}</div>
                  <div className="mt-4 flex items-center justify-between gap-2 text-xs text-ink-muted">
                    <span className="flex gap-3">
                      <span className="flex items-center gap-1"><Download size={13} aria-hidden /><span title={t("mods.downloads", { count: project.downloads })}>{count(project.downloads)}</span></span>
                      <span className="flex items-center gap-1"><Heart size={13} aria-hidden /><span title={t("mods.follows", { count: project.follows })}>{count(project.follows)}</span></span>
                    </span>
                    <Btn variant="primary" disabled={installing === project.id || locked} onClick={() => void installProject(project)}>
                      {installing === project.id ? t("mods.installing") : t("mods.install")}
                    </Btn>
                  </div>
                </Card>
              ))}
            </div>
          </>
        ) : (
          <>
            {!loading && mods.length === 0 && <Card><p className="text-sm text-ink-muted">{t("mods.empty")}</p></Card>}
            {mods.length > 0 && filtered.length === 0 && <Card><p className="text-sm text-ink-muted">{t("mods.noMatch", { query })}</p></Card>}
            <ul className="flex flex-col gap-2">
              {filtered.map((m) => {
                const label = m.name ?? m.fileName;
                return (
                  <li key={m.fileName} className="flex items-center gap-4 rounded-xl border border-line bg-panel px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold">{label}</span>
                        {!m.enabled && <Pill>{t("mods.disabled")}</Pill>}
                      </div>
                      <div dir="ltr" className="truncate text-xs text-ink-muted">{m.fileName}{m.version ? ` · ${m.version}` : ""}{m.loader ? ` · ${m.loader}` : ""}</div>
                      {m.problems.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{m.problems.map((p) => <Pill key={p} tone="danger">{p}</Pill>)}</div>}
                    </div>
                    <Toggle label={t("mods.toggle", { name: label })} checked={m.enabled} disabled={locked} onChange={() => toggle(m)} />
                    <Btn variant="danger" disabled={locked} onClick={() => setRemoving(m)}>{t("common.remove")}</Btn>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {removing && (
        <ConfirmDialog
          title={t("mods.removeTitle")}
          body={t("mods.removeBody", { name: removing.name ?? removing.fileName })}
          confirmLabel={t("common.remove")}
          busy={removeBusy}
          onCancel={() => setRemoving(null)}
          onConfirm={() => void confirmRemove()}
        />
      )}
    </div>
  );
}
