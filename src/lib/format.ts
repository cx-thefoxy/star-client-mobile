import type { Category } from "../types/api";

const CATEGORY_ORDER: Category[] = ["release", "snapshot", "pre_release", "release_candidate", "old_beta", "old_alpha", "other"];
export const categoryRank = (c: Category) => CATEGORY_ORDER.indexOf(c);

export function fmtMb(bytes: number): string {
  return `${Math.round(bytes / 1_048_576).toLocaleString("en-US")} MB`;
}

export function pct(p: { doneBytes: number; totalBytes: number; doneFiles: number; totalFiles: number }): number | null {
  if (p.totalBytes > 0) return Math.min(100, (p.doneBytes / p.totalBytes) * 100);
  if (p.totalFiles > 0) return Math.min(100, (p.doneFiles / p.totalFiles) * 100);
  return null;
}

/** Exact-identifier search (case-insensitive, trimmed). */
export function matchesExact(id: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q.length === 0 || id.toLowerCase() === q;
}
