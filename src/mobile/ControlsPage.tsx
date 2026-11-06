import { useRef } from "react";
import { Check, Copy, Download, Import, Pencil, Plus, Trash2 } from "lucide-react";
import { useControls, parseProfile, type Profile } from "./controls";
import { useApp } from "../store/app";

function Preview({ p }: { p: Profile }) {
  return (
    <div className="relative mb-2 aspect-[844/390] w-full overflow-hidden rounded-lg border border-line" style={{ background: "linear-gradient(#2b3a52, #3a5a2e 55%, #3b2a1a)" }}>
      {p.widgets.map((w) => (
        <div key={w.id} style={{ left: `${w.x}%`, top: `${w.y}%`, width: `${(w.w / 844) * 100}%`, height: `${(w.h / 390) * 100}%`, opacity: w.kind === "touchpad" ? 0.25 : 0.8 }}
          className={`absolute border border-white/70 ${w.kind === "touchpad" ? "bg-white/20" : "bg-white/10"} ${w.round ? "rounded-full" : "rounded-[2px]"}`} />
      ))}
    </div>
  );
}

/** Touch-control layouts: choose one, create, duplicate, import/export (also reads PojavLauncher control files), edit. */
export function ControlsPage() {
  const { profiles, active, setActive, newProfile, deleteProfile, importProfile } = useControls();
  const setPage = useApp((s) => s.setPage);
  const toast = useApp((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  const exportProfile = async (id: string) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    const text = JSON.stringify({ name: p.name, widgets: p.widgets }, null, 2);
    try { await navigator.clipboard.writeText(text); toast("info", { key: "common.copied" }); }
    catch { toast("error", { key: "common.copyFailed" }); }
  };
  const onImport = async (f?: File) => {
    if (!f) return;
    const p = parseProfile(await f.text());
    if (p) importProfile(p); else toast("error", { key: "controls.invalid" });
    if (fileRef.current) fileRef.current.value = "";
  };
  const ib = "grid h-8 w-8 place-items-center rounded-full active:bg-white/10";
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2.5 rounded-[22px] bg-panel p-3">
      <header className="flex items-start justify-between gap-3">
        <div><h1 className="text-lg font-semibold leading-tight">On-screen controls</h1><p className="text-[11px] text-ink-muted">Move, resize and bind every button, the joystick and the look area.</p></div>
        <div className="flex shrink-0 gap-2">
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void onImport(e.target.files?.[0])} />
          <button onClick={() => fileRef.current?.click()} className="flex h-9 items-center gap-1.5 rounded-xl bg-control px-3 text-xs font-semibold text-accent active:bg-control-hover"><Import size={14} />Import</button>
          <button onClick={() => newProfile()} className="flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-semibold text-accent-ink active:opacity-80"><Plus size={14} />New layout</button>
        </div>
      </header>
      <div className="scroll min-h-0 flex-1">
        <ul className="grid grid-cols-3 gap-2">
          {profiles.map((p) => (
            <li key={p.id} className={`flex flex-col gap-1 rounded-2xl border p-2.5 ${active === p.id ? "border-accent/40 bg-accent/5" : "border-transparent bg-raised"}`}>
              <Preview p={p} />
              <div className="flex items-center gap-1.5 text-sm font-semibold"><span className="truncate">{p.name}</span>{active === p.id && <Check size={14} className="shrink-0 text-ok" />}</div>
              <div className="mb-1 text-[11px] text-ink-muted">{p.widgets.length} controls</div>
              <div className="flex items-center gap-1">
                <button onClick={() => setActive(p.id)} className={`h-8 flex-1 rounded-lg bg-control text-xs font-semibold active:bg-control-hover ${active === p.id ? "text-accent" : "text-ink"}`}>{active === p.id ? "In use" : "Use"}</button>
                <button onClick={() => { setActive(p.id); setPage("editor"); }} className={ib} aria-label="Edit"><Pencil size={14} /></button>
                <button onClick={() => newProfile(p.id)} className={ib} aria-label="Duplicate"><Copy size={14} /></button>
                <button onClick={() => void exportProfile(p.id)} className={ib} aria-label="Copy layout JSON"><Download size={14} /></button>
                <button onClick={() => deleteProfile(p.id)} className={ib} aria-label="Delete"><Trash2 size={14} /></button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
