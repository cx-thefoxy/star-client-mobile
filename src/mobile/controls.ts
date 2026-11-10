import { create } from "zustand";

export type Kind = "button" | "joystick" | "touchpad" | "hotbar";
export interface Widget {
  id: string; kind: Kind; label: string; key: string;
  x: number; y: number; w: number; h: number; // x,y in % of the screen; w,h in px
  opacity: number; toggle: boolean; round: boolean;
  radius?: number; stroke?: number; swipe?: boolean; tint?: string; // radius: % of the short side
}
export interface Profile { id: string; name: string; widgets: Widget[] }
export type Renderer = "Holy GL4ES" | "LTW";

let n = 0;
export const uid = () => `w${Date.now().toString(36)}${n++}`;
const W = (kind: Kind, label: string, key: string, x: number, y: number, w: number, h: number, round = true, toggle = false): Widget =>
  ({ id: uid(), kind, label, key, x, y, w, h, opacity: 0.75, toggle, round });

export const PRESETS: { group: string; items: Omit<Widget, "id" | "x" | "y" | "opacity">[] }[] = [
  { group: "Movement", items: [
    { kind: "joystick", label: "Move", key: "WASD", w: 120, h: 120, toggle: false, round: true },
    { kind: "button", label: "Jump", key: "Space", w: 52, h: 52, toggle: false, round: true },
    { kind: "button", label: "Sneak", key: "Shift", w: 46, h: 46, toggle: true, round: true },
    { kind: "button", label: "Sprint", key: "Ctrl", w: 46, h: 46, toggle: true, round: true },
  ] },
  { group: "Mouse", items: [
    { kind: "button", label: "Attack", key: "LMB", w: 52, h: 52, toggle: false, round: true },
    { kind: "button", label: "Place", key: "RMB", w: 52, h: 52, toggle: false, round: true },
    { kind: "button", label: "Pick", key: "MMB", w: 40, h: 40, toggle: false, round: true },
  ] },
  { group: "Keys", items: [
    { kind: "button", label: "Inv", key: "E", w: 40, h: 40, toggle: false, round: false },
    { kind: "button", label: "Chat", key: "T", w: 40, h: 40, toggle: false, round: false },
    { kind: "button", label: "Drop", key: "Q", w: 40, h: 40, toggle: false, round: false },
    { kind: "button", label: "Swap", key: "F", w: 40, h: 40, toggle: false, round: false },
    { kind: "button", label: "Esc", key: "Esc", w: 40, h: 40, toggle: false, round: false },
    { kind: "button", label: "F5", key: "F5", w: 40, h: 40, toggle: false, round: false },
    { kind: "button", label: "F3", key: "F3", w: 40, h: 40, toggle: false, round: false },
    { kind: "button", label: "Keyboard", key: "KEYBOARD", w: 72, h: 40, toggle: true, round: false },
  ] },
  { group: "Pojav style", items: [
    { kind: "button", label: "W", key: "W", w: 44, h: 44, toggle: false, round: false },
    { kind: "button", label: "A", key: "A", w: 44, h: 44, toggle: false, round: false },
    { kind: "button", label: "S", key: "S", w: 44, h: 44, toggle: false, round: false },
    { kind: "button", label: "D", key: "D", w: 44, h: 44, toggle: false, round: false },
    { kind: "button", label: "Tab", key: "Tab", w: 44, h: 36, toggle: false, round: false },
    { kind: "button", label: "Scroll ↑", key: "ScrollUp", w: 44, h: 36, toggle: false, round: false },
    { kind: "button", label: "Scroll ↓", key: "ScrollDown", w: 44, h: 36, toggle: false, round: false },
    { kind: "button", label: "Hide", key: "HIDE", w: 44, h: 36, toggle: true, round: false },
    { kind: "button", label: "Menu", key: "Menu", w: 44, h: 36, toggle: false, round: false },
  ] },
];

type Preset = (typeof PRESETS)[number]["items"][number];
const P = (g: number, i: number) => PRESETS[g].items[i];
/** Multi-button packs added in one tap. dx/dy are in % of the screen, relative to the first item. */
export const PACKS: { label: string; items: (Preset & { dx: number; dy: number })[] }[] = [
  { label: "D-pad (W A S D)", items: [
    { ...P(3, 0), dx: 5.4, dy: 0 }, { ...P(3, 1), dx: 0, dy: 11.6 }, { ...P(3, 2), dx: 5.4, dy: 11.6 }, { ...P(3, 3), dx: 10.8, dy: 11.6 } ] },
  { label: "Combat pad (Attack + Place + Jump)", items: [
    { ...P(1, 1), dx: 0, dy: 0 }, { ...P(1, 2), dx: 7, dy: 0 }, { ...P(0, 1), dx: 3.5, dy: 17 } ] },
];

const REF_W = 844, REF_H = 390;
/** Find a free spot (in %) so new controls never stack on top of each other. */
const freeSpot = (ws: Widget[], w: number, h: number): { x: number; y: number } => {
  const rects = ws.map((o) => ({ l: (o.x / 100) * REF_W, t: (o.y / 100) * REF_H, r: (o.x / 100) * REF_W + o.w, b: (o.y / 100) * REF_H + o.h }));
  const cands: { x: number; y: number; d: number }[] = [];
  for (let x = 0; x <= 100 - (w / REF_W) * 100; x += 3) for (let y = 0; y <= 100 - (h / REF_H) * 100; y += 6)
    cands.push({ x, y, d: Math.hypot(x - 45, y - 40) });
  cands.sort((a, b) => a.d - b.d);
  const hit = (c: { x: number; y: number }) => { const l = (c.x / 100) * REF_W, t = (c.y / 100) * REF_H;
    return rects.some((q) => l < q.r + 4 && l + w + 4 > q.l && t < q.b + 4 && t + h + 4 > q.t); };
  return cands.find((c) => !hit(c)) ?? { x: 40, y: 40 };
};

const defaultWidgets = (): Widget[] => [
  W("joystick", "Move", "WASD", 4, 54, 120, 120),
  W("button", "Jump", "Space", 86, 58, 56, 56),
  W("button", "Attack", "LMB", 76, 36, 52, 52),
  W("button", "Place", "RMB", 90, 34, 52, 52),
  W("button", "Sneak", "Shift", 77, 72, 46, 46, true, true),
  W("button", "Sprint", "Ctrl", 17, 38, 44, 44, true, true),
  W("button", "Inv", "E", 91, 17, 40, 40, false),
  W("button", "Chat", "T", 84, 17, 40, 40, false),
  W("button", "Esc", "Esc", 2, 17, 40, 40, false),
  W("button", "Keyboard", "KEYBOARD", 9, 17, 72, 40, false, true),
  W("button", "Swap", "F", 68, 3, 40, 40, false),
  W("button", "Drop", "Q", 74, 3, 40, 40, false),
  W("button", "F5", "F5", 80, 3, 40, 40, false),
  W("button", "Pick", "MMB", 86, 3, 40, 40, false),
  W("button", "Tab", "Tab", 92, 3, 44, 36, false),
];

/** Best-effort PojavLauncher control JSON import (mControlDataList / mJoystickDataList). Key codes are GLFW + Pojav specials. */
const POJAV_KEYS: Record<number, string> = { 32: "Space", 340: "Shift", 341: "Ctrl", 256: "Esc", 258: "Tab", 257: "Enter", 292: "F3", 294: "F5", [-1]: "KEYBOARD", [-2]: "HIDE", [-3]: "LMB", [-4]: "RMB", [-6]: "MMB", [-7]: "ScrollUp", [-8]: "ScrollDown", [-9]: "Menu" };
const pojavKey = (c: number): string | null => POJAV_KEYS[c] ?? (c >= 65 && c <= 90 || c >= 48 && c <= 57 ? String.fromCharCode(c) : c >= 290 && c <= 301 ? `F${c - 289}` : null);
const evalDyn = (expr: unknown, w: number, h: number): number => {
  const e = String(expr ?? "0").replace(/\$\{(\w+)\}/g, (_m, k: string) => String(({ screen_width: REF_W, screen_height: REF_H, margin: 2, preferred_scale: 100, width: w, height: h, right: REF_W - w, bottom: REF_H - h } as Record<string, number>)[k] ?? 0)).replace(/\bscreen_width\b/g, String(REF_W)).replace(/\bscreen_height\b/g, String(REF_H));
  if (!/^[\d\s+\-*/().]+$/.test(e)) return 0;
  try { const r = Function(`"use strict";return (${e})`)(); return typeof r === "number" && isFinite(r) ? r : 0; } catch { return 0; }
};
const parsePojav = (v: { mControlDataList?: unknown[]; mJoystickDataList?: unknown[]; name?: string }, fallbackName: string): Profile | null => {
  type PD = { name?: string; keycodes?: number[]; dynamicX?: string; dynamicY?: string; width?: number; height?: number; opacity?: number; isToggle?: boolean; toggle?: boolean; cornerRadius?: number; strokeWidth?: number; isSwipeable?: boolean };
  const conv = (d: PD, joy: boolean): Widget | null => {
    const w = Math.max(30, Math.min(480, Math.round(d.width ?? 50))), h = Math.max(30, Math.min(260, Math.round(d.height ?? 50)));
    const x = evalDyn(d.dynamicX, w, h), y = evalDyn(d.dynamicY, w, h);
    const base = { id: uid(), x: Math.max(0, Math.min(100 - (w / REF_W) * 100, (x / REF_W) * 100)), y: Math.max(0, Math.min(100 - (h / REF_H) * 100, (y / REF_H) * 100)), w, h, opacity: Math.min(1, Math.max(0.2, d.opacity ?? 0.75)) };
    if (joy) return { ...base, kind: "joystick", label: d.name || "Move", key: "WASD", toggle: false, round: true, radius: 50 };
    const k = pojavKey(d.keycodes?.[0] ?? 0);
    const name = d.name || k || "?";
    const rad = typeof d.cornerRadius === "number" ? Math.min(50, Math.max(0, d.cornerRadius)) : 12;
    return { ...base, kind: "button", label: name, key: k ?? name, toggle: !!(d.isToggle ?? d.toggle), round: rad >= 40, radius: rad, stroke: d.strokeWidth, swipe: !!d.isSwipeable };
  };
  const widgets = [
    ...(v.mControlDataList ?? []).map((d) => conv(d as PD, false)),
    ...(v.mJoystickDataList ?? []).map((d) => conv(d as PD, true)),
  ].filter((w): w is Widget => !!w);
  return widgets.length ? { id: uid(), name: v.name || fallbackName, widgets } : null;
};

export const parseProfile = (text: string): Profile | null => {
  try {
    const v = JSON.parse(text);
    if (v && (Array.isArray(v.mControlDataList) || Array.isArray(v.mJoystickDataList))) return parsePojav(v, "Pojav import");
    if (!v || typeof v.name !== "string" || !Array.isArray(v.widgets)) return null;
    const widgets: Widget[] = v.widgets.filter((w: Widget) => w && gone(w) && typeof w.kind === "string" && typeof w.x === "number" && typeof w.y === "number")
      .map((w: Widget) => ({ ...w, id: uid() }));
    return { id: uid(), name: v.name, widgets };
  } catch { return null; }
};


/** Touch-controls state: layouts, the widget being edited and the on-device game display options. Saved in localStorage. */
const KEY = "star-mobile-controls-v1";
interface Saved { profiles: Profile[]; active: string; renderer: Renderer; resScale: number; guiScale: number; menuMode: boolean; hideOnScreenUI: boolean }
const load = (): Partial<Saved> => {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
};
const saved = load();
// The Look area and the on-screen Hotbar were removed: touch the game directly (drag = look, tap the game hotbar to pick a slot).
const gone = (w: Widget) => (w.kind as string) !== "touchpad" && (w.kind as string) !== "hotbar";
const okProfiles = Array.isArray(saved.profiles) && saved.profiles.length > 0 ? saved.profiles.map((p) => ({ ...p, widgets: (p.widgets ?? []).filter(gone) })) : null;

interface State {
  profiles: Profile[]; active: string; setActive: (id: string) => void;
  newProfile: (copyOf?: string) => void; deleteProfile: (id: string) => void; renameProfile: (id: string, name: string) => void; importProfile: (p: Profile) => void;
  editing: string | null; pick: (id: string | null) => void;
  addWidget: (p: Preset) => void; addCustom: (w: Omit<Widget, "id" | "x" | "y">) => void; addPack: (i: number) => void; duplicateWidget: (id: string) => void;
  patchWidget: (id: string, patch: Partial<Widget>) => void; removeWidget: (id: string) => void; resetProfile: () => void;
  slot: number; setSlot: (n: number) => void;
  renderer: Renderer; setRenderer: (r: Renderer) => void;
  resScale: number; setResScale: (n: number) => void; guiScale: number; setGuiScale: (n: number) => void;
  menuMode: boolean; setMenuMode: (v: boolean) => void; hideOnScreenUI: boolean; setHide: (v: boolean) => void;
}

const curWidgets = (s: State) => s.profiles.find((q) => q.id === s.active)!.widgets;
const patchActive = (s: State, fn: (w: Widget[]) => Widget[]) =>
  ({ profiles: s.profiles.map((p) => (p.id === s.active ? { ...p, widgets: fn(p.widgets) } : p)) });

export const useControls = create<State>((set) => ({
  profiles: okProfiles ?? [{ id: "p1", name: "Default", widgets: defaultWidgets() }, { id: "p2", name: "Minimal", widgets: defaultWidgets().slice(0, 7) }],
  active: okProfiles && okProfiles.some((p) => p.id === saved.active) ? (saved.active as string) : okProfiles ? okProfiles[0].id : "p1",
  setActive: (active) => set({ active, editing: null }),
  newProfile: (copyOf) => set((s) => {
    const src = s.profiles.find((p) => p.id === copyOf);
    const id = uid();
    const widgets = src ? src.widgets.map((w) => ({ ...w, id: uid() })) : defaultWidgets();
    return { profiles: [...s.profiles, { id, name: src ? `${src.name} copy` : "New layout", widgets }], active: id };
  }),
  deleteProfile: (id) => set((s) => {
    if (s.profiles.length < 2) return {};
    const profiles = s.profiles.filter((p) => p.id !== id);
    return { profiles, active: s.active === id ? profiles[0].id : s.active };
  }),
  renameProfile: (id, name) => set((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? { ...p, name } : p)) })),
  importProfile: (p) => set((s) => ({ profiles: [...s.profiles, p], active: p.id })),
  editing: null, pick: (editing) => set({ editing }),
  addWidget: (p) => set((s) => {
    const w: Widget = { ...p, id: uid(), ...freeSpot(curWidgets(s), p.w, p.h), opacity: 0.75 };
    return { ...patchActive(s, (ws) => [...ws, w]), editing: w.id };
  }),
  addCustom: (p) => set((s) => {
    const w: Widget = { ...p, id: uid(), ...freeSpot(curWidgets(s), p.w, p.h) };
    return { ...patchActive(s, (ws) => [...ws, w]), editing: w.id };
  }),
  addPack: (i) => set((s) => {
    const pack = PACKS[i]; const cur = curWidgets(s);
    const bw = Math.max(...pack.items.map((it) => (it.dx / 100) * REF_W + it.w)), bh = Math.max(...pack.items.map((it) => (it.dy / 100) * REF_H + it.h));
    const o = freeSpot(cur, bw, bh);
    const ws = pack.items.map((it): Widget => { const { dx, dy, ...rest } = it; return { ...rest, id: uid(), x: o.x + dx, y: o.y + dy, opacity: 0.75 }; });
    return { ...patchActive(s, (all) => [...all, ...ws]), editing: null };
  }),
  duplicateWidget: (id) => set((s) => {
    const src = curWidgets(s).find((w) => w.id === id);
    if (!src) return {};
    const w: Widget = { ...src, id: uid(), x: Math.min(src.x + 4, 95), y: Math.min(src.y + 8, 90) };
    return { ...patchActive(s, (ws) => [...ws, w]), editing: w.id };
  }),
  patchWidget: (id, patch) => set((s) => patchActive(s, (ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)))),
  removeWidget: (id) => set((s) => ({ ...patchActive(s, (ws) => ws.filter((w) => w.id !== id)), editing: null })),
  resetProfile: () => set((s) => ({ ...patchActive(s, () => defaultWidgets()), editing: null })),
  slot: 0, setSlot: (slot) => set({ slot }),
  renderer: saved.renderer === "LTW" ? "LTW" : "Holy GL4ES", setRenderer: (renderer) => set({ renderer }),
  resScale: saved.resScale ?? 100, setResScale: (resScale) => set({ resScale }),
  guiScale: saved.guiScale ?? 0, setGuiScale: (guiScale) => set({ guiScale }),
  menuMode: !!saved.menuMode, setMenuMode: (menuMode) => set({ menuMode }),
  hideOnScreenUI: !!saved.hideOnScreenUI, setHide: (hideOnScreenUI) => set({ hideOnScreenUI }),
}));

useControls.subscribe((s) => {
  try { localStorage.setItem(KEY, JSON.stringify({ profiles: s.profiles, active: s.active, renderer: s.renderer, resScale: s.resScale, guiScale: s.guiScale, menuMode: s.menuMode, hideOnScreenUI: s.hideOnScreenUI })); }
  catch { /* storage unavailable */ }
});
