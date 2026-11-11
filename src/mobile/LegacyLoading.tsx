import { useEffect, useRef, useState } from "react";
import mark from "../assets/splash-mark.png";
import { onGameLog } from "../services/tauri";

/**
 * Start-up screen for old versions (1.15 and below): they draw their own old Mojang picture while loading. This draws exactly the 1.21 start-up
 * screen (same sizes as Minecraft's LoadingOverlay: mark height d = 25% of min(0.75*width, height) at the screen centre, bar 4d x 10 at 83.25% height,
 * 1px border, 1px gap, white fill, 500 ms fade-in, 1000 ms fade-out) over the game.
 */
const MILESTONES: [RegExp, number][] = [
  [/Setting user/, 0.12], [/LWJGL Version/, 0.22], [/Reloading ResourceManager|Reloading/, 0.36], [/SoundSystem|Sound Library/, 0.55],
  [/Sound engine started/, 0.72], [/atlas/i, 0.9],
];

const seen = new Set<string>(); // one start-up screen per game launch (not again when the game page is reopened later)
/** Call ONCE per game page: true for old versions, only during the first minutes after the game was started. */
export const isLegacy = (g?: { version: string; startedAt: string }) => {
  if (!g) return false;
  const m = /^1\.(\d+)/.exec(g.version); const t = Date.parse(g.startedAt);
  if (!m || +m[1] >= 16) return false; // 1.16+ draw the same Mojang Studios screen as 1.21 themselves
  if (seen.has(g.startedAt)) return false;
  if (Number.isFinite(t) && Date.now() - t > 150000) return false;
  seen.add(g.startedAt); return true;
};

export default function LegacyLoading() {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 844, h: 390 });
  const [p, setP] = useState(0);
  const [phase, setPhase] = useState<"on" | "fade" | "off">("on");
  const [fin, setFin] = useState(false);

  useEffect(() => {
    const el = box.current; if (!el) return;
    const upd = () => setSize({ w: el.clientWidth || 844, h: el.clientHeight || 390 });
    upd(); const ro = new ResizeObserver(upd); ro.observe(el);
    const t = window.setTimeout(() => setFin(true), 30); // starts the 500 ms fade-in
    return () => { ro.disconnect(); window.clearTimeout(t); };
  }, []);

  useEffect(() => {
    let target = 0.1, atlasAt = 0, soundAt = 0, raf = 0, cur = 0, ending = false, endAt = 0;
    const t0 = Date.now();
    const sub = onGameLog((g) => {
      for (const [re, v] of MILESTONES) if (re.test(g.line) && v > target) { target = v; if (v >= 0.9 && !atlasAt) atlasAt = Date.now(); if (v >= 0.72 && !soundAt) soundAt = Date.now(); }
    });
    let last = performance.now();
    const tick = (now: number) => {
      // Minecraft: currentProgress = clamp(currentProgress * 0.95 + actualProgress * 0.05) once per frame (60 fps)
      const frames = Math.min(6, (now - last) / 16.667); last = now;
      const t = Date.now();
      if (!ending && ((atlasAt && t - atlasAt > 1500) || (soundAt && t - soundAt > 9000) || t - t0 > 150000)) { ending = true; endAt = t; }
      const q = ending ? 1 : Math.min(target, 0.92);
      for (let i = 0; i < frames; i++) cur = Math.max(0, Math.min(1, cur * 0.95 + q * 0.05));
      setP(cur);
      if (ending && (cur > 0.985 || t - endAt > 2500)) { setP(1); setPhase("fade"); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); sub.then((u) => u()).catch(() => {}); };
  }, []);

  useEffect(() => {
    if (phase !== "fade") return;
    const a = window.setTimeout(() => setPhase("off"), 1050);
    return () => window.clearTimeout(a);
  }, [phase]);

  if (phase === "off") return null;

  // Minecraft's GUI scale (auto): largest whole number so that the window is at least 320x240 scaled units.
  const dpr = window.devicePixelRatio || 1;
  const wp = size.w * dpr, hp = size.h * dpr;
  const gs = Math.max(1, Math.floor(Math.min(wp / 320, hp / 240)));
  const u = gs / dpr; // CSS pixels per Minecraft GUI unit
  const sw = wp / gs, sh = hp / gs; // scaled window size in GUI units
  const d = Math.min(sw * 0.75, sh) * 0.25; // logo height; the logo box is 4d x d
  const barW = Math.round(d * 4), barH = 10, fill = Math.ceil((barW - 2) * p);
  const bx = Math.round(sw / 2 - barW / 2), by = Math.round(sh * 0.8325) - 5;
  const markW = (d * 288) / 256; // the two texture halves joined: 288 x 256 px at the same scale
  const fading = phase === "fade";
  const a = fin ? 1 : 0;
  const px = (n: number) => `${n * u}px`;
  return (
    <div ref={box} className="absolute inset-0 z-[39] overflow-hidden" style={{ backgroundColor: "#000", opacity: fading ? 0 : 1, transition: "opacity 1000ms linear", pointerEvents: fading ? "none" : "auto" }} onPointerDown={(e) => e.stopPropagation()}>
      <div style={{ opacity: a, transition: "opacity 500ms linear" }}>
        <img src={mark} alt="" draggable={false} className="absolute select-none" style={{ left: px(sw / 2 - markW / 2), top: px(sh / 2 - d / 2), width: px(markW), height: px(d), imageRendering: "auto" }} />
        <div className="absolute" style={{ left: px(bx), top: px(by), width: px(barW), height: px(barH) }}>
          <div className="absolute bg-white" style={{ left: px(1), top: 0, right: px(1), height: px(1) }} />
          <div className="absolute bg-white" style={{ left: px(1), bottom: 0, right: px(1), height: px(1) }} />
          <div className="absolute bg-white" style={{ left: 0, top: 0, bottom: 0, width: px(1) }} />
          <div className="absolute bg-white" style={{ right: 0, top: 0, bottom: 0, width: px(1) }} />
          <div className="absolute bg-white" style={{ left: px(2), top: px(2), bottom: px(2), width: px(fill) }} />
        </div>
      </div>
    </div>
  );
}
