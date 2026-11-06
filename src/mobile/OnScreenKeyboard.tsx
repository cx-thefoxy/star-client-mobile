import { useState } from "react";
import { gameInput } from "./native";
import { typeChar } from "./keys";

const ROWS = ["1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
const key = "flex h-7 min-w-0 flex-1 items-center justify-center rounded-md bg-white/15 text-[11px] font-semibold active:bg-white/40";

/** Real keyboard for chat and commands: each key goes to the game as a GLFW key press plus a character event. */
export default function OnScreenKeyboard() {
  const [shift, setShift] = useState(false);
  const tap = (k: number) => { gameInput({ t: "key", key: k, down: true }); gameInput({ t: "key", key: k, down: false }); };
  const press = (ch: string) => typeChar(shift ? ch.toUpperCase() : ch.toLowerCase(), false);
  return (
    <div className="absolute inset-x-[10%] bottom-2 z-[38] rounded-xl border border-white/20 bg-black/75 p-2 backdrop-blur" onPointerDown={(e) => e.stopPropagation()}>
      {ROWS.map((r) => (
        <div key={r} className="mb-1 flex justify-center gap-1 px-4">
          {[...r].map((k) => <button key={k} className={key} onClick={() => press(k)}>{shift ? k : k.toLowerCase()}</button>)}
        </div>
      ))}
      <div className="flex justify-center gap-1">
        <button className={`${key} max-w-16 ${shift ? "!bg-white !text-black" : ""}`} onClick={() => setShift((v) => !v)}>Shift</button>
        {["/", ".", ",", "-", "_", ":"].map((c) => <button key={c} className={`${key} max-w-8`} onClick={() => typeChar(c, false)}>{c}</button>)}
        <button className={`${key} flex-[4]`} onClick={() => typeChar(" ", false)}>Space</button>
        <button className={`${key} max-w-14`} onClick={() => tap(259)}>⌫</button>
        <button className={`${key} max-w-14`} onClick={() => tap(257)}>Enter</button>
      </div>
    </div>
  );
}
