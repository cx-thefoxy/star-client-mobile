/** Bridge to the in-game side of the Rust backend (touch input, game surface). Fire and forget; errors are ignored. */
import { invoke } from "@tauri-apps/api/core";

export type InputEvt =
  | { t: "key"; key: number; down: boolean }
  | { t: "mouse"; button: number; down: boolean }
  | { t: "cursor"; x: number; y: number }
  | { t: "scroll"; dy: number }
  | { t: "char"; ch: number };

/**
 * Events must reach the game IN ORDER. Plain invoke() calls are handled concurrently on Android, so a quick tap could arrive as
 * "release, then press" and leave a key or mouse button stuck down. So events go out one at a time (the next only after the
 * previous call returned); runs of cursor moves are merged into the newest one.
 */
const queue: InputEvt[] = [];
let busy = false;

function pump() {
  if (busy) return;
  let e = queue.shift();
  if (!e) return;
  if (e.t === "cursor") while (queue[0]?.t === "cursor") e = queue.shift()!;
  busy = true;
  let done = false;
  const next = () => { if (done) return; done = true; busy = false; pump(); };
  const guard = window.setTimeout(next, 250); // never stall the queue if a call hangs
  void invoke("game_input", { evt: e }).catch(() => {}).finally(() => { window.clearTimeout(guard); next(); });
}

// Fast path: a direct, synchronous Java call (set up by MainActivity). Falls back to the Tauri invoke queue above when it is not there.
type Direct = { input: (t: string, key: number, button: number, down: boolean, x: number, y: number, dy: number) => void };
export const gameInput = (e: InputEvt) => {
  const d = (window as unknown as { StarNative?: Direct }).StarNative;
  if (d && queue.length === 0 && !busy) {
    try {
      switch (e.t) {
        case "key": d.input("key", e.key, 0, e.down, 0, 0, 0); return;
        case "mouse": d.input("mouse", 0, e.button, e.down, 0, 0, 0); return;
        case "cursor": d.input("cursor", 0, 0, false, e.x, e.y, 0); return;
        case "char": d.input("char", e.ch, 0, false, 0, 0, 0); return;
        case "scroll": d.input("scroll", 0, 0, false, 0, 0, e.dy); return;
      }
    } catch { /* fall back below */ }
  }
  queue.push(e); pump();
};

export const gameSurface = (show: boolean, scale = 1) => { void invoke("game_surface", { show, scale }).catch(() => {}); };
export const stopGame = () => invoke("stop_game").catch(() => {});
export const setMobileOpts = (renderer: string) => invoke("set_mobile_opts", { opts: { renderer } }).catch(() => {});
