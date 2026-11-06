/** Bridge to the in-game side of the Rust backend (touch input, game surface). Fire and forget; errors are ignored. */
import { invoke } from "@tauri-apps/api/core";

export type InputEvt =
  | { t: "key"; key: number; down: boolean }
  | { t: "mouse"; button: number; down: boolean }
  | { t: "cursor"; x: number; y: number }
  | { t: "scroll"; dy: number }
  | { t: "char"; ch: number };

let pendingCursor: { x: number; y: number } | null = null;
const send = (evt: InputEvt) => { void invoke("game_input", { evt }).catch(() => {}); };

/** Cursor moves are coalesced to one per animation frame; everything else goes out immediately and in order. */
export const gameInput = (e: InputEvt) => {
  if (e.t !== "cursor") { flushCursor(); send(e); return; }
  const idle = pendingCursor === null;
  pendingCursor = { x: e.x, y: e.y };
  if (idle) requestAnimationFrame(flushCursor);
};
function flushCursor() {
  if (!pendingCursor) return;
  const c = pendingCursor; pendingCursor = null;
  send({ t: "cursor", x: c.x, y: c.y });
}

export const gameSurface = (show: boolean, scale = 1) => { void invoke("game_surface", { show, scale }).catch(() => {}); };
export const stopGame = () => invoke("stop_game").catch(() => {});
export const setMobileOpts = (renderer: string) => invoke("set_mobile_opts", { opts: { renderer } }).catch(() => {});
