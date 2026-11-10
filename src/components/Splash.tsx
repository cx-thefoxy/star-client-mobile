import { useEffect, useRef, useState } from "react";
import logo from "../assets/star-logo.png";
import pkg from "../../package.json";

type Phase = "checking" | "ok" | "update";
const REPO = "cx-thefoxy/star-client-mobile";

const num = (v: string) => v.replace(/^v/i, "").split(/[.+-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
const newer = (a: string, b: string) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

/** Asks GitHub for the newest release. Never throws: offline or any error counts as "no update". */
async function checkUpdate(): Promise<{ update: boolean; version: string }> {
  try {
    const ctl = new AbortController();
    const t = window.setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { signal: ctl.signal, headers: { Accept: "application/vnd.github+json" } });
    window.clearTimeout(t);
    if (!r.ok) return { update: false, version: "" };
    const tag = String((await r.json()).tag_name ?? "");
    return { update: !!tag && newer(tag, pkg.version), version: tag.replace(/^v/i, "") };
  } catch { return { update: false, version: "" }; }
}

/**
 * Start-up screen: the Star mark with a white glint sweeping across it while the launcher loads and checks for updates.
 * When that finishes the glint turns green (up to date) or yellow (update available), then the screen fades out.
 * `ready` = the launcher has loaded its data; `reduced` = the "reduced motion" setting.
 */
export default function Splash({ ready, reduced, onDone }: { ready: boolean; reduced: boolean; onDone: () => void }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [info, setInfo] = useState<{ update: boolean; version: string } | null>(null);
  const [out, setOut] = useState(false);
  const [minOk, setMinOk] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    let alive = true;
    void checkUpdate().then((i) => { if (alive) setInfo(i); });
    const m = window.setTimeout(() => { setMinOk(true); }, reduced ? 600 : 5000); // at least two slow sweeps
    return () => { alive = false; window.clearTimeout(m); };
  }, [reduced]);

  useEffect(() => {
    if (phase !== "checking" || !ready || !minOk || !info) return;
    setPhase(info.update ? "update" : "ok");
    const a = window.setTimeout(() => setOut(true), reduced ? 500 : 2000); // the coloured sweep, then ~2 s after the result the screen fades out
    const b = window.setTimeout(() => done.current(), reduced ? 800 : 2600);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, [phase, ready, minOk, info, reduced]);

  const color = phase === "ok" ? "74,222,128" : phase === "update" ? "250,204,21" : "255,255,255";
  const text = phase === "checking" ? "Checking for updates…" : phase === "ok" ? "Up to date" : `Update available${info?.version ? ` · v${info.version}` : ""}`;

  return (
    <div role="status" aria-label={text} className="fixed inset-0 z-[100] flex items-center justify-center bg-bg" style={{ transition: "opacity .6s ease", opacity: out ? 0 : 1, pointerEvents: out ? "none" : "auto" }}>
      <style>{`
        @keyframes star-glint { from { background-position: 160% 0; } to { background-position: -60% 0; } }
        @keyframes star-halo { 0%,100% { opacity: .35; } 50% { opacity: .9; } }
        .star-wrap { position: relative; width: min(64vh, 62vw, 460px); aspect-ratio: 640 / 452; }
        .star-base, .star-glint { position: absolute; inset: 0; -webkit-mask: url(${logo}) center / contain no-repeat; mask: url(${logo}) center / contain no-repeat; }
        .star-base { background: rgb(255 255 255 / .5); }
        .star-glint { background-image: linear-gradient(105deg, transparent 36%, rgb(var(--glint)) 50%, transparent 64%); background-size: 260% 100%; background-repeat: no-repeat; animation: star-glint 2.4s ease-in-out infinite; }
        .star-glint.final { animation-duration: 1.8s; animation-iteration-count: 1; animation-fill-mode: both; }
        .star-halo { position: absolute; inset: -30%; border-radius: 50%; background: radial-gradient(circle, rgb(var(--glint) / .22), transparent 65%); animation: star-halo 2.3s ease-in-out infinite; transition: background .5s; }
        @media (prefers-reduced-motion: reduce) { .star-glint, .star-halo { animation: none; } }
      `}</style>
      <div className="star-wrap" style={{ "--glint": color } as React.CSSProperties}>
        <div className="star-halo" />
        <div className="star-base" />
        <div key={phase} className={`star-glint ${phase === "checking" ? "" : "final"}`} />
      </div>
    </div>
  );
}
