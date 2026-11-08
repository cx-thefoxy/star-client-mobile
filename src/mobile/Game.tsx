import { useEffect, useRef, useState } from "react";
import { Pause, Play, Pencil, LogOut } from "lucide-react";
import ControlsCanvas, { gamePx } from "./ControlsCanvas";
import NativeKeyboard, { toggleKeyboard } from "./NativeKeyboard";
import { lastKey } from "./keys";
import { useControls } from "./controls";
import { gameInput, gameSurface, stopGame } from "./native";
import { onGameExit, onGameLog } from "../services/tauri";
import { useApp } from "../store/app";

/**
 * The game screen. The real game renders on a native SurfaceView behind this (transparent) page; everything here is touch input:
 * drag = look (or move the cursor and click when "tap to click" is on), widgets = keys, joystick = WASD.
 */
export default function Game() {
  const { resScale, menuMode, setMenuMode, hideOnScreenUI, ctx, setCtx } = useControls();
  const setPage = useApp((s) => s.setPage);
  const look = useRef<{ id: number; x: number; y: number; moved: number } | null>(null);
  const cur = useRef({ x: 0, y: 0 });
  const [paused, setPaused] = useState(false);
  const [, setKb] = useState(false);
  // Cursor grab from the game: true = playing, false = a screen with a cursor (title menu, inventory, pause, chat...).
  const [grab, setGrab] = useState<boolean>(!!(window as unknown as { __starGrabState?: boolean }).__starGrabState);
  const [curCss, setCurCss] = useState<{ x: number; y: number } | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const tail = useRef<string[]>([]);

  useEffect(() => {
    gameSurface(true, resScale / 100);
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => { gameSurface(false); document.documentElement.style.background = ""; document.body.style.background = ""; };
  }, [resScale]);

  useEffect(() => {
    const w = window as unknown as { __starGrab?: (g: boolean) => void };
    w.__starGrab = (g) => setGrab(g);
    return () => { delete w.__starGrab; };
  }, []);

  // Which screen is open decides which buttons show: cursor released after E = inventory, after Esc = pause, anything else = menu.
  useEffect(() => {
    if (grab) { setCtx("game"); return; }
    // Guess from the control that was tapped just before the cursor was released (the chip below corrects a wrong guess).
    const age = Date.now() - lastKey.t, k0 = lastKey.k;
    setCtx((k0 === "E" && age < 2500) || (k0 === "RMB" && age < 1200) ? "inventory" : k0 === "Esc" && age < 2500 ? "pause" : "menu"); // RMB = chest, crafting table, villager...
  }, [grab, setCtx]);

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

  // On a cursor screen (title menu, inventory, pause...) the finger works in one of two ways, chosen with the "Mouse" button:
  //  ON  = touchpad: the finger moves a visible cursor RELATIVELY, tap = click at the cursor, two quick taps = double click, hold = drag.
  //  OFF = direct touch: no cursor, you tap the game's buttons right where they are (two quick taps = double click).
  // While playing (cursor grabbed) dragging always looks around.
  const touchpad = !grab && menuMode;
  const direct = !grab && !menuMode;
  const holdT = useRef<number | undefined>(undefined);
  const pressT = useRef<number | undefined>(undefined);
  const holding = useRef(false);
  const pressed = useRef(false);
  const t0 = useRef(0);
  const clampCur = () => { cur.current = { x: Math.min(Math.max(cur.current.x, 0), window.innerWidth * k), y: Math.min(Math.max(cur.current.y, 0), window.innerHeight * k) }; };
  const sendPos = () => gameInput({ t: "cursor", ...cur.current });
  // The game needs to see the cursor on the widget for a moment (hover) before the press, and the press must last a few frames.
  const clickNow = () => {
    sendPos();
    window.setTimeout(() => { sendPos(); gameInput({ t: "mouse", button: 0, down: true }); }, 70);
    window.setTimeout(() => gameInput({ t: "mouse", button: 0, down: false }), 190);
  };
  useEffect(() => {
    if (!touchpad) return;
    if (cur.current.x === 0 && cur.current.y === 0) cur.current = { x: (window.innerWidth / 2) * k, y: (window.innerHeight / 2) * k };
    setCurCss({ x: cur.current.x / k, y: cur.current.y / k });
    sendPos();
  }, [touchpad, k]);

  const down = (e: React.PointerEvent) => {
    if (paused || look.current) return;
    look.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
    t0.current = Date.now(); holding.current = false; pressed.current = false;
    if (touchpad) {
      holdT.current = window.setTimeout(() => {
        if ((look.current?.moved ?? 99) < 12) { holding.current = true; sendPos(); gameInput({ t: "mouse", button: 0, down: true }); }
      }, 450);
    } else if (direct) {
      cur.current = { x: e.clientX * k, y: e.clientY * k };
      sendPos();
      pressT.current = window.setTimeout(() => { pressT.current = undefined; pressed.current = true; sendPos(); gameInput({ t: "mouse", button: 0, down: true }); }, 70);
    }
  };
  const move = (e: React.PointerEvent) => {
    const l = look.current; if (!l || l.id !== e.pointerId) return;
    const dx = e.clientX - l.x, dy = e.clientY - l.y; look.current = { ...l, x: e.clientX, y: e.clientY, moved: l.moved + Math.abs(dx) + Math.abs(dy) };
    if (touchpad) { const g = 1.6; cur.current = { x: cur.current.x + dx * k * g, y: cur.current.y + dy * k * g }; clampCur(); setCurCss({ x: cur.current.x / k, y: cur.current.y / k }); }
    else if (direct) cur.current = { x: e.clientX * k, y: e.clientY * k };
    else cur.current = { x: cur.current.x + dx * k, y: cur.current.y + dy * k };
    sendPos();
  };
  const up = (e: React.PointerEvent) => {
    const l = look.current;
    if (!l || l.id !== e.pointerId) return;
    look.current = null;
    window.clearTimeout(holdT.current);
    if (touchpad) {
      if (holding.current) { holding.current = false; gameInput({ t: "mouse", button: 0, down: false }); return; }
      if (l.moved < 12 && Date.now() - t0.current < 400 && e.type === "pointerup") clickNow();
    } else if (direct) {
      if (pressT.current !== undefined) { window.clearTimeout(pressT.current); pressT.current = undefined; clickNow(); }
      else if (pressed.current) { pressed.current = false; window.setTimeout(() => gameInput({ t: "mouse", button: 0, down: false }), 60); }
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ touchAction: "none" }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {!hideOnScreenUI && <ControlsCanvas edit={false} onKb={toggleKeyboard} ctx={ctx} />}
      <NativeKeyboard onOpen={() => setKb(true)} onClose={() => setKb(false)} />
      {touchpad && !paused && curCss && (
        <svg className="pointer-events-none absolute z-[37]" width="22" height="22" viewBox="0 0 24 24" style={{ left: curCss.x - 3, top: curCss.y - 2 }}>
          <path d="M3 2l7.5 19 2.6-7.4L21 11z" fill="#fff" stroke="#000" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      )}
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
