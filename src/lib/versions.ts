import type { Category, VersionRow } from "../types/api";

export type Channel = "all" | "release" | "snapshot" | "pre" | "old";
export type SortKey = "newest" | "oldest" | "name";

export interface VersionFilter { channel: Channel; installedOnly: boolean; query: string; sort: SortKey }

const CHANNEL_CATS: Record<Channel, Category[] | null> = {
  all: null,
  release: ["release"],
  snapshot: ["snapshot"],
  pre: ["pre_release", "release_candidate"],
  old: ["old_beta", "old_alpha"],
};

export function filterVersions(rows: VersionRow[], f: VersionFilter, visibility: { snapshots: boolean; oldBeta: boolean; oldAlpha: boolean }): VersionRow[] {
  const q = f.query.trim().toLowerCase();
  const allowed = (c: Category) => {
    if (c === "snapshot" || c === "pre_release" || c === "release_candidate") return visibility.snapshots;
    if (c === "old_beta") return visibility.oldBeta;
    if (c === "old_alpha") return visibility.oldAlpha;
    return true;
  };
  const cats = CHANNEL_CATS[f.channel];
  const out = rows.filter((r) => {
    if (!allowed(r.category)) return false;
    if (cats && !cats.includes(r.category)) return false;
    if (f.installedOnly && r.status !== "installed") return false;
    if (q && r.id.toLowerCase() !== q) return false; // exact identifier search, per spec
    return true;
  });
  const t = (s: string) => Date.parse(s) || 0;
  out.sort((a, b) => {
    if (f.sort === "name") return a.id.localeCompare(b.id, "en", { numeric: true });
    const d = t(b.releaseTime) - t(a.releaseTime);
    return f.sort === "newest" ? d : -d;
  });
  return out;
}
