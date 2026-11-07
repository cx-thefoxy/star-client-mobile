// Locale-aware formatting. Technical identifiers (versions, paths, file names) are
// deliberately NOT routed through here: they keep Latin digits in every language.
import { formatNumber, LANGS, translate, type Lang } from "./index";

export function fmtCount(lang: Lang, n: number): string {
  return formatNumber(lang, n);
}

export function fmtMegabytes(lang: Lang, mb: number): string {
  return translate(lang, "units.mb", { value: Math.round(mb) });
}

export function fmtBytesAsMb(lang: Lang, bytes: number, digits = 0): string {
  const mb = bytes / 1_048_576;
  const value = formatNumber(lang, mb, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  return translate(lang, "units.mb", { value });
}

export function fmtDate(lang: Lang, iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso; // unknown format: show as-is instead of "Invalid Date"
  return new Intl.DateTimeFormat(LANGS[lang].locale, { year: "numeric", month: "short", day: "numeric" }).format(d);
}

export function fmtDuration(lang: Lang, secs: number): string {
  const total = Math.max(0, Math.floor(secs));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? translate(lang, "time.hoursMinutes", { h, m }) : translate(lang, "time.minutes", { m });
}
