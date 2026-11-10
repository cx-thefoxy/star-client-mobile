/** GLFW key codes (LwjglGlfwKeycode) for widget keys, and the helpers that forward input to the native layer. */
import { gameInput } from "./native";

const GLFW: Record<string, number> = {
  Space: 32, Esc: 256, Enter: 257, Tab: 258, Backspace: 259,
  Right: 262, Left: 263, Down: 264, Up: 265, Shift: 340, Ctrl: 341, Alt: 342,
};
for (let i = 0; i < 26; i++) GLFW[String.fromCharCode(65 + i)] = 65 + i;
for (let i = 0; i < 10; i++) GLFW[String(i)] = 48 + i;
for (let i = 1; i <= 12; i++) GLFW[`F${i}`] = 289 + i;

/** GLFW mouse buttons: left 0, right 1, middle 2. */
const MOUSE: Record<string, number> = { LMB: 0, RMB: 1, MMB: 2 };
/** Widget keys that are handled by the launcher UI only (nothing is sent to the game). */
const UI_ONLY = new Set(["Menu", "HIDE", "KEYBOARD", "Mouse", "1-9", "WASD"]);

export const glfwKey = (k: string): number | undefined => GLFW[k];

/** Last widget key pressed: the game screen uses it to tell Inventory (E) from Pause (Esc) when the cursor is released. */
export const lastKey = { k: "", t: 0 };

/** Press/release a widget key in the game. Unknown or UI-only keys are ignored. */
const held = new Set<string>();
/** Releases every widget key/button that is still held (screen changed, finger lost, app in background...). Prevents stuck Attack/keys. */
export function releaseAllHeld() { for (const k of [...held]) sendWidgetKey(k, false); }

export function sendWidgetKey(k: string, down: boolean) {
  if (UI_ONLY.has(k)) return;
  if (down) { lastKey.k = k; lastKey.t = Date.now(); held.add(k); } else held.delete(k);
  if (k in MOUSE) { gameInput({ t: "mouse", button: MOUSE[k], down }); return; }
  if (k === "ScrollUp" || k === "ScrollDown") { if (down) gameInput({ t: "scroll", dy: k === "ScrollUp" ? 1 : -1 }); return; }
  const c = GLFW[k];
  if (c !== undefined) gameInput({ t: "key", key: c, down });
}

/** Joystick direction -> W/A/S/D held state. */
export function joystickKeys(dx: number, dy: number, radius: number): { W: boolean; A: boolean; S: boolean; D: boolean } {
  const t = radius * 0.35;
  return { W: dy < -t, S: dy > t, A: dx < -t, D: dx > t };
}

/** Types one character: key press (for shortcuts) followed by the char event Minecraft's text fields read. */
// Characters that are not letters or digits: [GLFW key, needs Shift] on a US keyboard layout.
const SHIFTED: Record<string, [number, boolean]> = {
  " ": [32, false], "'": [39, false], ",": [44, false], "-": [45, false], ".": [46, false], "/": [47, false], ";": [59, false], "=": [61, false],
  "[": [91, false], "\\": [92, false], "]": [93, false], "`": [96, false],
  "!": [49, true], "@": [50, true], "#": [51, true], "$": [52, true], "%": [53, true], "^": [54, true], "&": [55, true], "*": [56, true], "(": [57, true], ")": [48, true],
  "_": [45, true], "+": [61, true], ":": [59, true], "\"": [39, true], "<": [44, true], ">": [46, true], "?": [47, true], "{": [91, true], "}": [93, true], "|": [92, true], "~": [96, true],
};
export function typeChar(ch: string, shift: boolean) {
  const isLetter = /[a-zA-Z]/.test(ch);
  const code = isLetter || /[0-9]/.test(ch) ? GLFW[ch.toUpperCase()] : SHIFTED[ch]?.[0];
  const needShift = isLetter ? /[A-Z]/.test(ch) || shift : SHIFTED[ch]?.[1] ?? false;
  if (needShift) gameInput({ t: "key", key: 340, down: true });
  if (code !== undefined) gameInput({ t: "key", key: code, down: true });
  gameInput({ t: "char", ch: (isLetter && shift ? ch.toUpperCase() : ch).charCodeAt(0) });
  if (code !== undefined) gameInput({ t: "key", key: code, down: false });
  if (needShift) gameInput({ t: "key", key: 340, down: false });
}
