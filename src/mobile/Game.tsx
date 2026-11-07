import { useEffect, useRef, useState } from "react";
import { Pause, Play, Pencil, LogOut } from "lucide-react";
import ControlsCanvas, { gamePx } from "./ControlsCanvas";
import OnScreenKeyboard from "./OnScreenKeyboard";
import { useControls } from "./controls";
import { gameInput, gameSurface, stopGame } from "./native";
import { onGameExit, onGameLog } from "../services/tauri";
import { useApp } from "../store/app";

/**
 * The game screen. The real game renders on a native SurfaceView behind this (transparent) page; everything here is touch input:
 * drag = look (or move the cursor and click when "tap to click" is on), widgets = keys, joystick = WASD.
 */
export default function Game() {
  const { resScale, menuMode, setMenuMode, hideOnScreenUI } = useControls();
  const setPage = useApp((s) => s.setPage);
  const look = useRef<{ id: number; x: number; y: number; moved: number } | null>(null);
  const cur = useRef({ x: 0, y: 0 });
  const [paused, setPaused] = useState(false);
  const [kb, setKb] = useState(false);
  const [ended, setEnded] = useState<string | null>(null);
  const tail = useRef<string[]>([]);

  useEffect(() => {
    gameSurface(true, resScale / 100);
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => { gameSurface(false); document.documentElement.style.background = ""; document.body.style.background = ""; };
  }, [resScale]);

  useEffect(() => {
    const subs = [
      onGameLog((g) => { tail.current = [...tail.current.slice(-39), g.line]; }),
      onGameExit(() => setEnded(tail.current.slice(-8).join("\n"))),
    ];
    return () => { subs.forEach((p) => p.then((u) => u()).catch(() => {})); };
  }, []);

  const k = gamePx(resScale);
  const quit = () => { void stopGame(); setPage("home"); };
  const item = "flex h-10 w-full items-center gap-2 rounded-lg bg-control px-3 text-sm hover:bg-control-hover";

  // Touchpad mode ("Mouse ON"): the finger moves the cursor RELATIVELY (anywhere on screen), tap = click at the cursor,
  // two quick taps = double click, press-and-hold = hold the button (drag items). "Mouse OFF": drag = look around.
  const ptr = useRef<HTMLDivElement>(null);
  const holdT = useRef<number | undefined>(undefined);
  const holding = useRef(false);
  const t0 = useRef(0);
  const showCur = () => { if (ptr.current) ptr.current.style.transform = `translate(${cur.current.x / k}px,${cur.current.y / k}px)`; };
  const clamp = () => {
    cur.current = { x: Math.min(Math.max(cur.current.x, 0), window.innerWidth * k), y: Math.min(Math.max(cur.current.y, 0), window.innerHeight * k) };
  };
  const click = () => {
    gameInput({ t: "cursor", ...cur.current });
    gameInput({ t: "mouse", button: 0, down: true });
    window.setTimeout(() => gameInput({ t: "mouse", button: 0, down: false }), 45);
  };
  useEffect(() => {
    if (menuMode && cur.current.x === 0 && cur.current.y === 0) { cur.current = { x: (window.innerWidth / 2) * k, y: (window.innerHeight / 2) * k }; }
    showCur();
    if (menuMode) gameInput({ t: "cursor", ...cur.current });
  }, [menuMode, k]);

  const down = (e: React.PointerEvent) => {
    if (paused || look.current) return;
    look.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
    t0.current = Date.now(); holding.current = false;
    if (menuMode) {
      holdT.current = window.setTimeout(() => {
        if ((look.current?.moved ?? 99) < 12) { holding.current = true; gameInput({ t: "cursor", ...cur.current }); gameInput({ t: "mouse", button: 0, down: true }); }
      }, 450);
    }
  };
  const move = (e: React.PointerEvent) => {
    const l = look.current; if (!l || l.id !== e.pointerId) return;
    const dx = e.clientX - l.x, dy = e.clientY - l.y; look.current = { ...l, x: e.clientX, y: e.clientY, moved: l.moved + Math.abs(dx) + Math.abs(dy) };
    if (menuMode) { const g = 1.6; cur.current = { x: cur.current.x + dx * k * g, y: cur.current.y + dy * k * g }; clamp(); showCur(); }
    else cur.current = { x: cur.current.x + dx * k, y: cur.current.y + dy * k };
    gameInput({ t: "cursor", ...cur.current });
  };
  const up = (e: React.PointerEvent) => {
    const l = look.current;
    if (l?.id !== e.pointerId) return;
    look.current = null;
    window.clearTimeout(holdT.current);
    if (!menuMode) return;
    if (holding.current) { holding.current = false; gameInput({ t: "mouse", button: 0, down: false }); return; }
    if (l.moved < 12 && Date.now() - t0.current < 400 && e.type === "pointerup") click();
  };

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ touchAction: "none" }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {!hideOnScreenUI && <ControlsCanvas edit={false} onKb={() => setKb((v) => !v)} />}
      {kb && <OnScreenKeyboard />}
      {menuMode && <div ref={ptr} className="pointer-events-none absolute left-0 top-0 z-[34]" style={{ willChange: "transform" }}>
        <svg width="22" height="22" viewBox="0 0 22 22"><path d="M2 2 L2 17 L6.5 13 L9.5 20 L12 19 L9 12 L15 12 Z" fill="white" stroke="black" strokeWidth="1.2" /></svg>
      </div>}
      <button onClick={() => setMenuMode(!menuMode)} aria-pressed={menuMode} onPointerDown={(e) => e.stopPropagation()}
        className="absolute left-1/2 top-2 z-[36] flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-lg bg-black/50 px-3 text-[11px] font-medium text-white">
        <span className={`h-2 w-2 rounded-full ${menuMode ? "bg-green-400" : "bg-white/40"}`} />Mouse: {menuMode ? "ON" : "OFF"}
      </button>
      <button onClick={() => setPaused(true)} onPointerDown={(e) => e.stopPropagation()} className="absolute left-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-white"><Pause size={14} /></button>
      {ended !== null && (
        <div className="absolute inset-0 z-[45] flex items-center justify-center bg-black/70 p-3" onPointerDown={(e) => e.stopPropagation()}>
          <div className="w-[340px] max-w-full rounded-2xl border border-line bg-panel p-4 shadow-2xl">
            <div className="text-sm font-semibold">Game closed</div>
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] leading-snug text-ink-muted">{ended}</pre>
            <button className={`${item} mt-3 justify-center`} onClick={quit}>Back to launcher</button>
          </div>
        </div>
      )}
      {paused && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60" onPointerDown={(e) => e.stopPropagation()}>
          <div className="w-[260px] space-y-2 rounded-2xl border border-line bg-panel p-4 shadow-2xl">
            <div className="mb-1 text-sm font-semibold">Paused</div>
            <button className={item} onClick={() => setPaused(false)}><Play size={15} />Resume</button>
            <button className={item} onClick={() => { void stopGame(); setPage("editor"); }}><Pencil size={15} />Edit controls (closes the game)</button>
            <button className={`${item} text-danger`} onClick={quit}><LogOut size={15} />Quit game</button>
          </div>
        </div>
      )}
    </div>
  );
}
