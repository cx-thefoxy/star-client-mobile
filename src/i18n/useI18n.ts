import { useMemo } from "react";
import { useApp } from "../store/app";
import { LANGS, translatorFor, type Lang } from "./index";
import { describeError } from "./errors";
import * as f from "./format";

/**
 * React access to the active language. Subscribes only to the language, so every
 * component re-renders immediately when it changes and never on unrelated state.
 */
export function useI18n() {
  const lang = useApp((s) => s.lang);
  return useMemo(() => i18nFor(lang), [lang]);
}

export function i18nFor(lang: Lang) {
  return {
    lang,
    dir: LANGS[lang].dir,
    t: translatorFor(lang),
    count: (n: number) => f.fmtCount(lang, n),
    mb: (mb: number) => f.fmtMegabytes(lang, mb),
    bytesMb: (bytes: number, digits?: number) => f.fmtBytesAsMb(lang, bytes, digits),
    date: (iso: string | null | undefined) => f.fmtDate(lang, iso),
    duration: (secs: number) => f.fmtDuration(lang, secs),
    error: (e: unknown) => describeError(lang, e),
  };
}
export type I18n = ReturnType<typeof i18nFor>;
