// Central localization runtime. Components never contain UI strings: they call
// `t("namespace.key", params)` from `useI18n()` (React) or `translate()` (non-React).
//
// Layout vs. text direction (see ./README.md):
//   * The document is ALWAYS laid out left-to-right. English is the canonical layout,
//     Persian never mirrors the sidebar, toolbars, flex/grid order or icons.
//   * Persian strings are rendered right-to-left at the *text* level only: every
//     Persian translation is wrapped in a Unicode Right-to-Left Isolate (RLI … PDI),
//     and every interpolated value (names, versions, paths) in a First-Strong
//     Isolate (FSI … PDI). This gives correct glyph order and punctuation for
//     Persian and for mixed Persian/English text in any container (buttons, flex
//     items, <option>, aria-label, title) without touching layout.
import { en, type Key } from "./en";

export type { Key };
export type Lang = "en";
export type Params = Record<string, string | number>;

export const LANGS: Record<Lang, { dir: "ltr" | "rtl"; locale: string; nativeName: string }> = {
  en: { dir: "ltr", locale: "en-US", nativeName: "English" },
};
/** Matches the Rust default in src-tauri/src/config/mod.rs (`Appearance::default`). */
export const DEFAULT_LANG: Lang = "en";

export const dictionaries: Record<Lang, Partial<Record<Key, string>>> = { en };

export const isLang = (x: unknown): x is Lang => x === "en";
export const normalizeLang = (x: unknown): Lang => (isLang(x) ? x : DEFAULT_LANG);

const LRI = "\u2066", RLI = "\u2067", FSI = "\u2068", PDI = "\u2069";
const BIDI_CONTROLS = /[\u2066-\u2069\u200e\u200f\u202a-\u202e]/g;

/** Wraps text in a bidi isolate. `auto` = first strong character decides (user content). */
export function isolate(text: string, dir: "ltr" | "rtl" | "auto" = "auto"): string {
  if (!text) return text;
  return (dir === "rtl" ? RLI : dir === "ltr" ? LRI : FSI) + text + PDI;
}
/** Removes bidi control characters (tests, clipboard, comparisons). */
export const plain = (text: string) => text.replace(BIDI_CONTROLS, "");

const isDev = (() => {
  try { return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV); } catch { return false; }
})();
const reported = new Set<string>();
/** Development-time detector for missing or empty translations. Collected for tests. */
export const missingReports: string[] = [];
function reportMissing(lang: Lang, key: string) {
  const id = `${lang}:${key}`;
  if (reported.has(id)) return;
  reported.add(id);
  missingReports.push(id);
  if (isDev) console.warn(`[i18n] missing "${key}" for "${lang}"; falling back to English`);
}

export function formatNumber(lang: Lang, n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(LANGS[lang].locale, opts).format(n);
}

/**
 * Looks up `key` for `lang`, interpolates `{param}` placeholders and applies text
 * direction isolation. Numbers are formatted for the locale;
 * strings are treated as opaque values (instance names, versions, paths) and never
 * translated or digit-converted.
 */
export function translate(lang: Lang, key: Key, params?: Params): string {
  let raw = dictionaries[lang][key];
  let effective: Lang = lang;
  if (raw === undefined || raw === "") {
    reportMissing(lang, key);
    raw = en[key];
    effective = "en";
    if (raw === undefined) {
      if (isDev) console.error(`[i18n] unknown key "${key}"`);
      return `⟦${key}⟧`;
    }
  }
  const out = params
    ? raw.replace(/\{(\w+)\}/g, (m, name: string) => {
        const v = params[name];
        if (v === undefined) { if (isDev) console.warn(`[i18n] "${key}" is missing param {${name}}`); return m; }
        return typeof v === "number" ? isolate(formatNumber(lang, v), "ltr") : isolate(String(v), "auto");
      })
    : raw;
  return LANGS[effective].dir === "rtl" ? isolate(out, "rtl") : out;
}

export type Translator = (key: Key, params?: Params) => string;
export const translatorFor = (lang: Lang): Translator => (key, params) => translate(lang, key, params);

/** Keys present in English but missing/empty in `lang`. Used by tests and scripts/check-i18n.mjs. */
export function missingKeys(lang: Lang): Key[] {
  return (Object.keys(en) as Key[]).filter((k) => !dictionaries[lang][k]);
}
