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

export const gameInput = (e: InputEvt) => { queue.push(e); pump(); };

export const gameSurface = (show: boolean, scale = 1) => { void invoke("game_surface", { show, scale }).catch(() => {}); };
export const stopGame = () => invoke("stop_game").catch(() => {});
export const setMobileOpts = (renderer: string) => invoke("set_mobile_opts", { opts: { renderer } }).catch(() => {});
