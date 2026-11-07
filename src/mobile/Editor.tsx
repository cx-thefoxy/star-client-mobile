import { useState } from "react";
import { ArrowLeft, Copy, Grid3x3, Plus, RotateCcw, Trash2, X, Zap, Check } from "lucide-react";
import { useControls, PRESETS, PACKS, type Kind, type Widget } from "./controls";
import { useApp } from "../store/app";
import ControlsCanvas, { Face, radiusOf } from "./ControlsCanvas";

const KEYS = ["Space", "Shift", "Ctrl", "E", "Q", "T", "Tab", "F3", "F5", "Esc", "LMB", "RMB", "MMB", "ScrollUp", "ScrollDown", "Menu", "HIDE", "KEYBOARD"];
const MORE = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)];
const TINTS = [undefined, "#ffffff", "#ef4444", "#22c55e", "#3b82f6", "#eab308"];
const KINDS: { id: Kind; label: string; w: number; h: number; name: string; key: string; radius: number }[] = [
  { id: "button", label: "Button", w: 52, h: 52, name: "Button", key: "Space", radius: 50 },
  { id: "joystick", label: "Joystick", w: 120, h: 120, name: "Move", key: "WASD", radius: 50 },
  { id: "touchpad", label: "Look area", w: 260, h: 200, name: "Look", key: "Mouse", radius: 12 },
  { id: "hotbar", label: "Hotbar", w: 360, h: 40, name: "Hotbar", key: "1-9", radius: 12 },
];
const inp = "h-8 w-full rounded-lg bg-control px-2 text-xs text-ink outline-none focus:ring-1 focus:ring-accent";
const chip = (on: boolean) => `rounded-md px-1.5 py-1 text-[10px] ${on ? "bg-accent text-accent-ink" : "bg-control"}`;

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="mb-2 block text-[11px] text-ink-muted"><span className="mb-1 block">{label}</span>{children}</label>
);
const Range = ({ label, v, min, max, on }: { label: string; v: number; min: number; max: number; on: (n: number) => void }) => (
  <Row label={`${label} · ${v}`}><input type="range" min={min} max={max} value={v} onChange={(e) => on(+e.target.value)} /></Row>
);
const Tint = ({ v, on }: { v?: string; on: (t: string | undefined) => void }) => (
  <Row label="Color">
    <div className="flex gap-1.5">
      {TINTS.map((t) => (
        <button key={t ?? "none"} onClick={() => on(t)} aria-label={t ?? "Default"} className={`flex h-6 w-6 items-center justify-center rounded-full border ${v === t ? "border-accent" : "border-line"}`} style={{ background: t ?? "linear-gradient(135deg,#222 50%,#555 50%)" }}>
          {v === t && <Check size={11} className={t === "#ffffff" || t === "#eab308" ? "text-black" : "text-white"} />}
        </button>
      ))}
    </div>
  </Row>
);
const KeyPick = ({ v, on }: { v: string; on: (k: string) => void }) => (
  <Row label="Key">
    <div className="mb-1 flex flex-wrap gap-1">{KEYS.map((k) => <button key={k} onClick={() => on(k)} className={chip(v === k)}>{k}</button>)}</div>
    <select value={MORE.includes(v) ? v : ""} onChange={(e) => e.target.value && on(e.target.value)} className={inp}>
      <option value="">Other key…</option>
      {MORE.map((k) => <option key={k} value={k}>{k}</option>)}
    </select>
  </Row>
);
const Toggles = ({ w, on }: { w: Pick<Widget, "toggle" | "swipe">; on: (p: Partial<Widget>) => void }) => (
  <div className="mb-2 flex gap-1.5 text-[11px]">
    <button onClick={() => on({ toggle: !w.toggle })} className={`flex-1 rounded-lg py-1.5 ${w.toggle ? "bg-accent text-accent-ink" : "bg-control"}`}>Toggle</button>
    <button onClick={() => on({ swipe: !w.swipe })} className={`flex-1 rounded-lg py-1.5 ${w.swipe ? "bg-accent text-accent-ink" : "bg-control"}`}>Swipe</button>
  </div>
);

type Draft = Omit<Widget, "id" | "x" | "y">;
const draftOf = (k: (typeof KINDS)[number]): Draft => ({ kind: k.id, label: k.name, key: k.key, w: k.w, h: k.h, opacity: 0.75, toggle: false, round: k.radius >= 40, radius: k.radius, stroke: 1, swipe: false });

function AddDialog({ onClose }: { onClose: () => void }) {
  const { addCustom } = useControls();
  const [d, setD] = useState<Draft>(draftOf(KINDS[0]));
  const set = (p: Partial<Draft>) => setD((o) => ({ ...o, ...p }));
  const sq = d.kind === "button" || d.kind === "joystick";
  const pw: Widget = { ...d, id: "preview", x: 0, y: 0 };
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex max-h-[370px] w-[600px] flex-col rounded-2xl border border-line bg-panel shadow-2xl">
        <div className="flex items-center justify-between px-4 pt-3 text-sm font-semibold">New control<button onClick={onClose} aria-label="Close"><X size={15} /></button></div>
        <div className="flex min-h-0 flex-1 gap-3 p-4 pt-2">
          <div className="flex w-[170px] shrink-0 flex-col gap-2">
            <div className="flex flex-wrap gap-1">{KINDS.map((k) => <button key={k.id} onClick={() => setD(draftOf(k))} className={`rounded-lg px-2 py-1.5 text-[11px] ${d.kind === k.id ? "bg-accent text-accent-ink" : "bg-control"}`}>{k.label}</button>)}</div>
            <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-xl bg-bg">
              <div style={{ width: Math.min(d.w, 150), height: Math.min(d.h, 130), opacity: d.opacity }}><Face w={{ ...pw, w: Math.min(d.w, 150), h: Math.min(d.h, 130) }} down={false} knob={{ x: 0, y: 0 }} /></div>
            </div>
          </div>
          <div className="scroll min-w-0 flex-1 pr-1">
            <Row label="Name"><input value={d.label} onChange={(e) => set({ label: e.target.value })} className={inp} /></Row>
            {d.kind === "button" && <KeyPick v={d.key} on={(key) => set({ key })} />}
            <Range label="Width" v={d.w} min={30} max={d.kind === "hotbar" ? 480 : 340} on={(w) => set({ w, h: sq ? w : d.h })} />
            {!sq && <Range label="Height" v={d.h} min={30} max={260} on={(h) => set({ h })} />}
            <Range label="Corners %" v={radiusOf(d as Widget)} min={0} max={50} on={(radius) => set({ radius, round: radius >= 40 })} />
            <Range label="Border" v={d.stroke ?? 1} min={0} max={6} on={(stroke) => set({ stroke })} />
            <Range label="Opacity %" v={Math.round(d.opacity * 100)} min={20} max={100} on={(n) => set({ opacity: n / 100 })} />
            {d.kind === "button" && <Toggles w={d} on={set} />}
            <Tint v={d.tint} on={(tint) => set({ tint })} />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line p-3">
          <button onClick={onClose} className="h-8 rounded-lg bg-control px-4 text-xs">Cancel</button>
          <button onClick={() => { addCustom(d); onClose(); }} className="h-8 rounded-lg bg-accent px-4 text-xs font-semibold text-accent-ink">Create</button>
        </div>
      </div>
    </div>
  );
}

export default function Editor({ openAdd = false, openCustom = false }: { openAdd?: boolean; openCustom?: boolean }) {
  const { profiles, active, editing, pick, addWidget, addPack, duplicateWidget, patchWidget, removeWidget, resetProfile } = useControls();
  const setPage = useApp((s) => s.setPage);
  const [quick, setQuick] = useState(openAdd);
  const [custom, setCustom] = useState(openCustom);
  const [snap, setSnap] = useState(false);
  const [added, setAdded] = useState<Record<string, number>>({});
  const p = profiles.find((x) => x.id === active)!;
  const w = p.widgets.find((x) => x.id === editing);
  const btn = "flex h-8 items-center gap-1.5 rounded-lg bg-black/60 px-3 text-xs font-medium backdrop-blur hover:bg-black/80";
  const bump = (k: string) => setAdded((o) => ({ ...o, [k]: (o[k] ?? 0) + 1 }));

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg">
      <div className="absolute inset-0 bg-black/60" />
      <ControlsCanvas edit onKb={() => {}} snap={snap} />
      <div className="absolute inset-x-0 top-0 z-30 flex items-center gap-2 p-2">
        <button className={btn} onClick={() => setPage("controls")}><ArrowLeft size={14} />Back</button>
        <div className={`${btn} pointer-events-none`}>Editing: {p.name}</div>
        <div className="flex-1" />
        <button className={btn} onClick={() => { setQuick((v) => !v); pick(null); }}><Zap size={14} />Quick add</button>
        <button className={btn} onClick={() => { setCustom(true); setQuick(false); pick(null); }}><Plus size={14} />Add</button>
        <button className={`${btn} ${snap ? "!bg-white !text-black" : ""}`} onClick={() => setSnap((v) => !v)} aria-label="Snap to grid"><Grid3x3 size={14} />Snap</button>
        <button className={btn} onClick={resetProfile}><RotateCcw size={14} />Reset</button>
        
      </div>

      {quick && (
        <div className="scroll absolute right-2 top-12 z-30 max-h-[320px] w-[310px] rounded-xl border border-line bg-panel p-3 shadow-2xl">
          <div className="mb-0.5 flex items-center justify-between text-xs font-semibold">Quick add<button onClick={() => setQuick(false)}><X size={14} /></button></div>
          <div className="mb-2 text-[10px] text-ink-faint">Ready-made: size, shape and key are already set. Tap to drop it on a free spot.</div>
          <div className="mb-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-faint">Packs</div>
            <div className="flex flex-wrap gap-1.5">
              {PACKS.map((k, i) => (
                <button key={k.label} onClick={() => { addPack(i); bump(k.label); }} className="rounded-lg bg-control px-2.5 py-1.5 text-[11px] hover:bg-control-hover">{k.label}{added[k.label] ? ` ·${added[k.label]}` : ""}</button>
              ))}
            </div>
          </div>
          {PRESETS.map((g) => (
            <div key={g.group} className="mb-2">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-faint">{g.group}</div>
              <div className="flex flex-wrap gap-1.5">
                {g.items.map((it) => (
                  <button key={it.label} onClick={() => { addWidget(it); bump(it.label); }} className="rounded-lg bg-control px-2.5 py-1.5 text-[11px] hover:bg-control-hover">
                    {it.label}<span className="ml-1 text-[9px] text-ink-faint">{it.w}×{it.h}{added[it.label] ? ` · ✓${added[it.label]}` : ""}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {custom && <AddDialog onClose={() => setCustom(false)} />}

      {w && !quick && (
        <div className="scroll absolute bottom-2 right-2 top-12 z-30 w-[230px] rounded-xl border border-line bg-panel p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold">
            {w.kind === "button" ? "Button" : w.kind[0].toUpperCase() + w.kind.slice(1)}
            <button onClick={() => pick(null)}><X size={14} /></button>
          </div>
          <Row label="Label"><input value={w.label} onChange={(e) => patchWidget(w.id, { label: e.target.value })} className={inp} /></Row>
          {w.kind === "button" && <KeyPick v={w.key} on={(key) => patchWidget(w.id, { key })} />}
          {w.kind !== "hotbar" && <Range label="Width" v={w.w} min={30} max={340} on={(n) => patchWidget(w.id, { w: n, h: w.kind === "button" || w.kind === "joystick" ? n : w.h })} />}
          {w.kind === "touchpad" && <Range label="Height" v={w.h} min={30} max={260} on={(n) => patchWidget(w.id, { h: n })} />}
          <Range label="Corners %" v={radiusOf(w)} min={0} max={50} on={(radius) => patchWidget(w.id, { radius, round: radius >= 40 })} />
          <Range label="Border" v={w.stroke ?? 1} min={0} max={6} on={(stroke) => patchWidget(w.id, { stroke })} />
          <Range label="Opacity %" v={Math.round(w.opacity * 100)} min={20} max={100} on={(n) => patchWidget(w.id, { opacity: n / 100 })} />
          {w.kind === "button" && <Toggles w={w} on={(pp) => patchWidget(w.id, pp)} />}
          <Tint v={w.tint} on={(tint) => patchWidget(w.id, { tint })} />
          <div className="flex gap-1.5">
            <button onClick={() => duplicateWidget(w.id)} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-control text-xs font-medium"><Copy size={13} />Duplicate</button>
            <button onClick={() => removeWidget(w.id)} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-danger/15 text-xs font-medium text-danger"><Trash2 size={13} />Delete</button>
          </div>
        </div>
      )}
      {!w && !quick && !custom && <div className="pointer-events-none absolute bottom-[58px] left-1/2 z-30 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] text-white/80">Drag to move · tap to edit · drag the dot to resize</div>}
    </div>
  );
}
