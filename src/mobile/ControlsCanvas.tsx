import { useRef, useState } from "react";
import { sendWidgetKey, joystickKeys } from "./keys";
import { useControls, type Widget } from "./controls";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const SW = 844, SH = 390;

/** Real game pixels per CSS px (device pixel ratio x resolution scale). */
export const gamePx = (resScale: number) => (window.devicePixelRatio || 1) * (resScale / 100);
/** Minecraft GUI scale: Auto = biggest n with width/n >= 320 and height/n >= 240; a manual value is capped to that same max. */
export const effectiveGuiScale = (guiScale: number, resScale: number) => {
  const k = gamePx(resScale);
  const max = Math.max(1, Math.min(Math.floor((window.innerWidth * k) / 320), Math.floor((window.innerHeight * k) / 240)));
  return guiScale ? Math.min(guiScale, max) : max;
};

export const radiusOf = (w: Widget) => w.radius ?? (w.round ? 50 : 12);

export function Face({ w, down, knob, slot = 0 }: { w: Widget; down: boolean; knob: { x: number; y: number }; slot?: number }) {
  const rad = `${(Math.min(w.w, w.h) * radiusOf(w)) / 100}px`;
  const bw = w.stroke ?? 1;
  if (w.kind === "joystick")
    return (
      <div className="flex h-full w-full items-center justify-center border border-white/40 bg-white/10" style={{ borderRadius: rad, borderWidth: bw, borderColor: w.tint }}>
        <div className="h-[42%] w-[42%] rounded-full border border-white/70 bg-white/30" style={{ transform: `translate(${knob.x}px,${knob.y}px)`, backgroundColor: w.tint ? `${w.tint}55` : undefined }} />
      </div>
    );
  if (w.kind === "touchpad")
    return <div className="flex h-full w-full items-center justify-center border border-dashed border-white/30 bg-white/[0.04] text-[11px] text-white/60" style={{ borderRadius: rad }}>{w.label} · mouse area</div>;
  if (w.kind === "hotbar")
    return (
      <div className="flex h-full w-full gap-[2px] border border-white/40 bg-black/40 p-[2px]" style={{ borderRadius: rad }}>
        {Array.from({ length: 9 }, (_, i) => (
          <div key={i} className={`flex flex-1 items-center justify-center rounded-sm text-[10px] ${i === slot ? "border-2 border-white bg-white/25" : "border border-white/20 bg-white/10"}`}>{i + 1}</div>
        ))}
      </div>
    );
  return (
    <div className={`flex h-full w-full items-center justify-center whitespace-nowrap border font-semibold ${down ? "border-white bg-white/60 text-black" : "border-white/50 bg-black/45 text-white"}`}
      style={{ fontSize: Math.max(8, Math.min(11, (w.w - 8) / Math.max(1, w.label.length * 0.62))), borderRadius: rad, borderWidth: bw, ...(w.tint && !down ? { borderColor: w.tint, backgroundColor: `${w.tint}55` } : {}) }}>{w.label}</div>
  );
}

function Item({ w, edit, snap, onKb }: { w: Widget; edit: boolean; snap: boolean; onKb: () => void }) {
  const { editing, pick, patchWidget, guiScale, resScale, slot, setSlot } = useControls();
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const size = useRef<{ px: number; py: number; w: number; h: number } | null>(null);
  const [down, setDown] = useState(false);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const held = useRef({ W: false, A: false, S: false, D: false });
  const setMove = (dx: number, dy: number, rad: number) => {
    const n = joystickKeys(dx, dy, rad);
    (Object.keys(n) as (keyof typeof n)[]).forEach((k) => { if (n[k] !== held.current[k]) { held.current[k] = n[k]; sendWidgetKey(k, n[k]); } });
  };
  const parent = () => box.current!.parentElement!.getBoundingClientRect();
  const sq = w.kind === "button" || w.kind === "joystick";
  const hb = w.kind === "hotbar";
  // Vanilla hotbar is 182x22 GUI px = 182*s x 22*s game pixels. s = GUI scale (Auto = max that fits 320x240), so Auto/1/2/3... change its size like the game.
  const hs = effectiveGuiScale(guiScale, resScale) / gamePx(resScale), bw0 = hb ? Math.round(182 * hs) : w.w, bh0 = hb ? Math.round(22 * hs) : w.h;

  const slotAt = (e: React.PointerEvent) => { const r = box.current!.getBoundingClientRect(); return clamp(Math.floor(((e.clientX - r.left) / r.width) * 9), 0, 8); };
  const press = (k: string) => {
    if (k === "ScrollUp") setSlot((slot + 8) % 9);
    else if (k === "ScrollDown") setSlot((slot + 1) % 9);
  };
  const onDown = (e: React.PointerEvent) => {
    if (edit || w.kind !== "touchpad") e.stopPropagation(); // in play mode the Look area lets the touch reach the game (drag = look)
    e.currentTarget.setPointerCapture(e.pointerId);
    if (edit) { pick(w.id); if (hb) return; start.current = { px: e.clientX, py: e.clientY, x: w.x, y: w.y }; return; }
    if (hb) { const i = slotAt(e); setSlot(i); sendWidgetKey(String(i + 1), true); sendWidgetKey(String(i + 1), false); return; } // tap or drag on the hotbar picks the slot
    if (w.key === "KEYBOARD") onKb();
    press(w.key);
    sendWidgetKey(w.key, w.toggle ? !down : true);
    setDown(w.toggle ? !down : true);
  };
  const onMove = (e: React.PointerEvent) => {
    if (edit && start.current) {
      const r = parent();
      let x = start.current.x + ((e.clientX - start.current.px) / r.width) * 100, y = start.current.y + ((e.clientY - start.current.py) / r.height) * 100;
      if (snap) { x = Math.round(x / 2) * 2; y = Math.round(y / 4) * 4; }
      patchWidget(w.id, { x: clamp(x, 0, 100 - (w.w / r.width) * 100), y: clamp(y, 0, 100 - (w.h / r.height) * 100) });
    } else if (!edit && hb && e.buttons) {
      const i = slotAt(e); if (i !== slot) { setSlot(i); sendWidgetKey(String(i + 1), true); sendWidgetKey(String(i + 1), false); }
    } else if (!edit && w.kind === "joystick" && e.buttons) {
      const r = box.current!.getBoundingClientRect(), m = r.width / 3;
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1;
      setKnob({ x: (dx / d) * Math.min(d, m), y: (dy / d) * Math.min(d, m) });
      setMove(dx, dy, m);
    }
  };
  const onUp = () => { start.current = null; if (!edit) { if (!w.toggle) { setDown(false); sendWidgetKey(w.key, false); } setKnob({ x: 0, y: 0 }); setMove(0, 0, 1); } };

  const hDown = (e: React.PointerEvent) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); size.current = { px: e.clientX, py: e.clientY, w: w.w, h: w.h }; };
  const hMove = (e: React.PointerEvent) => {
    if (!size.current) return;
    const nw = clamp(Math.round(size.current.w + e.clientX - size.current.px), 30, w.kind === "hotbar" ? 480 : 340);
    patchWidget(w.id, sq ? { w: nw, h: nw } : { w: nw, h: clamp(Math.round(size.current.h + e.clientY - size.current.py), 30, 260) });
  };

  return (
    <div
      ref={box} className="ctl pointer-events-auto absolute" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      style={{ left: hb ? `calc(50% - ${bw0 / 2}px)` : `${w.x}%`, top: hb ? `calc(100% - ${bh0}px)` : `${w.y}%`, width: bw0, height: bh0, opacity: edit ? Math.max(w.opacity, 0.6) : w.opacity, zIndex: w.kind === "touchpad" ? 1 : 2 }}
    >
      <Face w={hb ? { ...w, w: bw0, h: bh0 } : w} down={down} knob={knob} slot={slot} />
      {edit && editing === w.id && !hb && (
        <>
          <div className="pointer-events-none absolute -inset-[3px] rounded-lg border-2 border-accent" />
          <div className="ctl absolute -bottom-[9px] -right-[9px] z-10 h-[18px] w-[18px] rounded-full border-2 border-accent-ink bg-accent" aria-label="Resize"
            onPointerDown={hDown} onPointerMove={hMove} onPointerUp={() => { size.current = null; }} onPointerCancel={() => { size.current = null; }} />
        </>
      )}
    </div>
  );
}

export default function ControlsCanvas({ edit, onKb, snap = false }: { edit: boolean; onKb: () => void; snap?: boolean }) {
  const { profiles, active, pick } = useControls();
  const p = profiles.find((x) => x.id === active)!;
  return (
    <div className={`absolute inset-0 ${edit ? "" : "pointer-events-none z-[35]"}`} onPointerDown={() => edit && pick(null)}>
      {edit && snap && <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "linear-gradient(to right, rgba(255,255,255,.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.07) 1px, transparent 1px)", backgroundSize: `${(SW * 2) / 100}px ${(SH * 4) / 100}px` }} />}
      {p.widgets.map((w) => <Item key={w.id} w={w} edit={edit} snap={snap} onKb={onKb} />)}
    </div>
  );
}
