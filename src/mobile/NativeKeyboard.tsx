import { useEffect, useRef } from "react";
import { gameInput } from "./native";
import { typeChar } from "./keys";

/** The hidden text field that opens the phone's own keyboard. Kept by Game so a tap can focus it synchronously (Android only shows the keyboard from a user gesture). */
export const kbField: { el: HTMLInputElement | null } = { el: null };
const SENT = "\u200b\u200b"; // sentinel text: lets us see Backspace even when the field is "empty"

let wanted = false; // the keyboard should be open: a stray blur (a tap on the game, a screen change) must not close it
let imeOpen: boolean | undefined; // reported by the Android side (undefined = unknown)
(window as unknown as { __starIme?: (v: boolean) => void }).__starIme = (v) => { imeOpen = v; if (!v) wanted = false; };
export const toggleKeyboard = () => {
  const el = kbField.el; if (!el) return;
  if (document.activeElement === el && imeOpen !== false) { wanted = false; el.blur(); }
  else { wanted = true; el.value = SENT; el.focus(); el.setSelectionRange(SENT.length, SENT.length); }
};

const tap = (k: number) => { gameInput({ t: "key", key: k, down: true }); gameInput({ t: "key", key: k, down: false }); };

/** Characters, Backspace and Enter typed on the phone keyboard go to the game as key + char events. */
export default function NativeKeyboard({ onOpen, onClose }: { onOpen: () => void; onClose: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { kbField.el = ref.current; return () => { kbField.el = null; wanted = false; }; }, []);
  const onInput = (e: React.FormEvent<HTMLInputElement>) => {
    const el = e.currentTarget, v = el.value;
    if (v.length < SENT.length) for (let i = v.length; i < SENT.length; i++) tap(259);
    else for (const ch of v.slice(SENT.length)) typeChar(ch, false);
    el.value = SENT; el.setSelectionRange(SENT.length, SENT.length);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); tap(257); }
    else if (e.key === "Backspace") { e.preventDefault(); tap(259); }
  };
  return (
    <input ref={ref} type="password" defaultValue={SENT} autoComplete="new-password" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="send" aria-label="Keyboard"
      onInput={onInput} onKeyDown={onKeyDown} onFocus={onOpen} onBlur={() => { if (wanted) { window.setTimeout(() => { const el = ref.current; if (wanted && el && document.activeElement !== el) el.focus(); }, 30); } else onClose(); }}
      style={{ position: "fixed", left: 0, bottom: 0, width: 2, height: 2, opacity: 0, border: 0, padding: 0, zIndex: 50 }} />
  );
}
