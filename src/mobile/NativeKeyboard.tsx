import { useEffect, useRef } from "react";
import { gameInput } from "./native";
import { typeChar } from "./keys";

/** The hidden text field that opens the phone's own keyboard. Kept by Game so a tap can focus it synchronously (Android only shows the keyboard from a user gesture). */
export const kbField: { el: HTMLInputElement | null } = { el: null };
const SENT = "\u200b\u200b"; // sentinel text: lets us see Backspace even when the field is "empty"

let imeOpen: boolean | undefined; // reported by the Android side (undefined = unknown)
/** The phone keyboard was shown or hidden (also by the system Back gesture): keep the hidden field in step with it. */
(window as unknown as { __starIme?: (v: boolean) => void }).__starIme = (v) => { imeOpen = v; if (!v && kbField.el && document.activeElement === kbField.el) kbField.el.blur(); };
/** One tap = one change. The field is blurred first, so a keyboard that Back hid (field still focused) opens again on the next tap. */
export const toggleKeyboard = () => {
  const el = kbField.el; if (!el) return;
  const visible = imeOpen !== undefined ? imeOpen : document.activeElement === el;
  el.blur();
  if (visible) { imeOpen = false; return; }
  el.value = SENT; el.focus(); el.setSelectionRange(SENT.length, SENT.length);
};

/** Keys of a hardware / Bluetooth keyboard (or a keyboard app) that are not text: GLFW key codes. */
const SPECIAL: Record<string, number> = {
  Escape: 256, Tab: 258, Delete: 261, ArrowRight: 262, ArrowLeft: 263, ArrowDown: 264, ArrowUp: 265,
  PageUp: 266, PageDown: 267, Home: 268, End: 269, F1: 290, F2: 291, F3: 292, F4: 293, F5: 294, F6: 295, F7: 296, F8: 297, F9: 298, F10: 299, F11: 300, F12: 301,
};

const tap = (k: number) => { gameInput({ t: "key", key: k, down: true }); gameInput({ t: "key", key: k, down: false }); };

/** Characters, Backspace and Enter typed on the phone keyboard go to the game as key + char events. */
export default function NativeKeyboard({ onOpen, onClose }: { onOpen: () => void; onClose: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { kbField.el = ref.current; return () => { kbField.el = null; }; }, []);
  const composing = useRef(false); // an IME (Persian, predictive text) is still building a word: send it once it is final
  const flush = (el: HTMLInputElement) => {
    const v = el.value;
    if (v.length < SENT.length) for (let i = v.length; i < SENT.length; i++) tap(259);
    else for (const ch of v.slice(SENT.length)) typeChar(ch, false);
    el.value = SENT; el.setSelectionRange(SENT.length, SENT.length);
  };
  const onInput = (e: React.FormEvent<HTMLInputElement>) => { if (!composing.current && !(e.nativeEvent as InputEvent).isComposing) flush(e.currentTarget); };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); tap(257); }
    else if (e.key === "Backspace" && !composing.current) { e.preventDefault(); tap(259); }
    else if (SPECIAL[e.key] !== undefined) { e.preventDefault(); gameInput({ t: "key", key: SPECIAL[e.key], down: true }); }
  };
  const onKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (SPECIAL[e.key] !== undefined) { e.preventDefault(); gameInput({ t: "key", key: SPECIAL[e.key], down: false }); }
  };
  return (
    <input ref={ref} type="password" defaultValue={SENT} autoComplete="new-password" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="send" aria-label="Keyboard"
      onInput={onInput} onKeyDown={onKeyDown} onKeyUp={onKeyUp} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={(e) => { composing.current = false; flush(e.currentTarget); }} onFocus={onOpen} onBlur={onClose}
      style={{ position: "fixed", left: 0, bottom: 0, width: 2, height: 2, opacity: 0, border: 0, padding: 0, zIndex: 50 }} />
  );
}
