import { useEffect, useState } from "react";
import logo from "../assets/star-logo.png";
import { onGameLog } from "../services/tauri";

/**
 * Start-up screen for old versions (1.13 and below): they only draw a static Mojang picture while loading. This draws the same look as
 * the 1.21 start-up screen (black, Star mark, white progress bar) over the game and fades out when the game has finished loading.
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
  if (!m || +m[1] >= 14) return false;
  if (seen.has(g.startedAt)) return false;
  if (Number.isFinite(t) && Date.now() - t > 150000) return false;
  seen.add(g.startedAt); return true;
};

export default function LegacyLoading() {
  const [p, setP] = useState(0.04);
  const [phase, setPhase] = useState<"on" | "fade" | "off">("on");

  useEffect(() => {
    let target = 0.1, atlasAt = 0, soundAt = 0;
    const t0 = Date.now();
    const sub = onGameLog((g) => {
      for (const [re, v] of MILESTONES) if (re.test(g.line) && v > target) { target = v; if (v >= 0.9 && !atlasAt) atlasAt = Date.now(); if (v >= 0.72 && !soundAt) soundAt = Date.now(); }
    });
    const id = window.setInterval(() => {
      const now = Date.now();
      setP((cur) => Math.min(1, cur + Math.max(0, Math.min(target, 0.92) - cur) * 0.12 + 0.0015)); // eases toward the newest milestone, creeps a little in between
      const done = (atlasAt && now - atlasAt > 1500) || (soundAt && now - soundAt > 9000) || now - t0 > 150000;
      if (done) { setP(1); setPhase("fade"); window.clearInterval(id); }
    }, 100);
    return () => { window.clearInterval(id); sub.then((u) => u()).catch(() => {}); };
  }, []);

  useEffect(() => {
    if (phase !== "fade") return;
    const a = window.setTimeout(() => setPhase("off"), 700);
    return () => window.clearTimeout(a);
  }, [phase]);

  if (phase === "off") return null;
  return (
    <div className="absolute inset-0 z-[39] bg-black" style={{ opacity: phase === "fade" ? 0 : 1, transition: "opacity 600ms ease", pointerEvents: phase === "fade" ? "none" : "auto" }} onPointerDown={(e) => e.stopPropagation()}>
      <img src={logo} alt="" draggable={false} className="absolute left-1/2 top-[40%] w-[13%] -translate-x-1/2 -translate-y-1/2 select-none" />
      <div className="absolute left-1/2 top-[83%] h-[3.4%] min-h-[14px] w-[45%] -translate-x-1/2 -translate-y-1/2 border-2 border-white p-[2px]">
        <div className="h-full bg-white" style={{ width: `${Math.round(p * 100)}%` }} />
      </div>
    </div>
  );
}
