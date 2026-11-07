import { useEffect, useState, type CSSProperties } from "react";
import { api } from "../services/tauri";
import type { Account } from "../types/api";
import steveSkin from "../assets/steve-skin.png";

/** Mojang returns http:// texture links; the app only allows https for images. */
export function httpsSkin(url: string | null | undefined): string | null {
  return url ? url.replace(/^http:\/\//i, "https://") : null;
}

const lookupCache = new Map<string, string>();
export type SkinLookup = "idle" | "loading" | "found" | "missing" | "error";

/** A username (3-16 letters, digits, underscore) or a player UUID (32 hex digits, dashes allowed). */
const SKIN_QUERY = /^(?:[a-z0-9_]{3,16}|[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** Skin of a Minecraft username or UUID (Mojang lookup through the backend, with fallback services). Debounced, cached, and safe against stale answers. */
export function useSkinLookup(name: string | null | undefined, enabled = true): { url: string | null; status: SkinLookup } {
  const key = (name ?? "").trim().toLowerCase();
  const valid = enabled && SKIN_QUERY.test(key);
  const [state, setState] = useState<{ key: string; url: string | null; status: SkinLookup }>({ key: "", url: null, status: "idle" });
  useEffect(() => {
    if (!valid) { setState({ key, url: null, status: "idle" }); return; }
    const hit = lookupCache.get(key);
    if (hit) { setState({ key, url: hit, status: "found" }); return; }
    let live = true;
    setState((s) => ({ key, url: s.key === key ? s.url : null, status: "loading" }));
    const timer = setTimeout(() => {
      api.lookupSkin(key).then((u) => {
        if (!live) return;
        const url = httpsSkin(u);
        if (url) lookupCache.set(key, url);
        setState({ key, url, status: url ? "found" : "missing" });
      }).catch(() => { if (live) setState({ key, url: null, status: "error" }); });
    }, 450);
    return () => { live = false; clearTimeout(timer); };
  }, [key, valid]);
  return state.key === key ? { url: state.url, status: state.status } : { url: null, status: valid ? "loading" : "idle" };
}

/** The skin to show for an account: its own skin (Microsoft) or the public skin that matches its name (offline). */
export function useAccountSkin(account: Pick<Account, "name" | "skinUrl" | "accountType"> | null | undefined): string | null {
  const own = httpsSkin(account?.skinUrl);
  const looked = useSkinLookup(account?.name, !!account && !own && account.accountType === "offline");
  return own ?? looked.url;
}

type Face = { x: number; y: number; place: string };
// Where each side of the head sits in a 64x64 skin (x, y of its 8x8 square), and how the square is placed on the cube.
const FACES: Face[] = [
  { x: 8, y: 8, place: "translateZ(calc(var(--c) / 2))" },
  { x: 24, y: 8, place: "rotateY(180deg) translateZ(calc(var(--c) / 2))" },
  { x: 0, y: 8, place: "rotateY(-90deg) translateZ(calc(var(--c) / 2))" },
  { x: 16, y: 8, place: "rotateY(90deg) translateZ(calc(var(--c) / 2))" },
  { x: 8, y: 0, place: "rotateX(90deg) translateZ(calc(var(--c) / 2))" },
  { x: 16, y: 0, place: "rotateX(-90deg) translateZ(calc(var(--c) / 2))" },
];
const HAT_FACES: Face[] = FACES.map((f) => ({ ...f, x: f.x + 32 }));

function Cube({ url, name }: { url: string; name: string }) {
  const layer = (faces: Face[], scale: number, label: string) => faces.map((f, i) => {
    const edge = scale === 1 ? "var(--s)" : `calc(var(--s) * ${scale})`;
    const style: CSSProperties = {
      width: edge, height: edge, marginLeft: `calc(${edge} / -2)`, marginTop: `calc(${edge} / -2)`,
      backgroundImage: `url("${url}")`,
      backgroundSize: `calc(${edge} * 8) calc(${edge} * 8)`,
      backgroundPosition: `calc(${edge} / -8 * ${f.x}) calc(${edge} / -8 * ${f.y})`,
      transform: f.place.replace(/var\(--c\)/g, edge),
    };
    return <span key={`${label}${i}`} className="head3d-face" style={style} />;
  });
  return (
    <span className="head3d-cube" role="img" aria-label={name}>
      {layer(FACES, 1, "h")}
      {layer(HAT_FACES, 1.125, "o")}
    </span>
  );
}

/**
 * A slowly turning 3D player head built from a skin texture (CSS 3D, no WebGL).
 * Without a skin it shows the default Steve head. Hover pauses the turn.
 */
export function SkinHead3D({ skinUrl, size = 112, label = "Skin" }: { skinUrl?: string | null; size?: number; label?: string }) {
  const wanted = httpsSkin(skinUrl);
  const [shown, setShown] = useState<string>(wanted ?? steveSkin);
  useEffect(() => {
    if (!wanted) { setShown(steveSkin); return; }
    let live = true;
    const img = new Image();
    img.onload = () => { if (live) setShown(wanted); };
    img.onerror = () => { if (live) setShown(steveSkin); };
    img.src = wanted;
    return () => { live = false; };
  }, [wanted]);
  const s = (size * 0.6) / 16;
  return (
    <span className="head3d" style={{ width: `${size / 16}rem`, height: `${size / 16}rem`, "--s": `${s}rem` } as CSSProperties}>
      <Cube url={shown} name={label} />
    </span>
  );
}
