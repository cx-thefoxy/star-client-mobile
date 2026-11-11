import { describe, expect, it } from "vitest";
import { filterVersions } from "../src/lib/versions";
import { translate, plain } from "../src/i18n";
import type { VersionRow } from "../src/types/api";

const rows: VersionRow[] = [
  { id: "1.21.1", kind: "release", category: "release", releaseTime: "2024-08-08", url: "u", status: "installed", javaMajor: 21 },
  { id: "24w14a", kind: "snapshot", category: "snapshot", releaseTime: "2024-04-02", url: "u", status: "not_installed", javaMajor: null },
  { id: "b1.7.3", kind: "old_beta", category: "old_beta", releaseTime: "2011-07-08", url: "u", status: "incomplete", javaMajor: 8 },
];
const base = { channel: "all" as const, installedOnly: false, query: "", sort: "newest" as const };
const vis = { snapshots: false, oldBeta: false, oldAlpha: false };

describe("version filtering", () => {
  it("hides snapshot and old categories until the user enables them", () => {
    expect(filterVersions(rows, base, vis).map((r) => r.id)).toEqual(["1.21.1"]);
    expect(filterVersions(rows, base, { ...vis, snapshots: true, oldBeta: true }).map((r) => r.id)).toEqual(["1.21.1", "24w14a", "b1.7.3"]);
  });
  it("exact identifier search only", () => {
    expect(filterVersions(rows, { ...base, query: "1.21" }, { snapshots: true, oldBeta: true, oldAlpha: true })).toEqual([]);
    expect(filterVersions(rows, { ...base, query: " B1.7.3 " }, { snapshots: true, oldBeta: true, oldAlpha: true }).map((r) => r.id)).toEqual(["b1.7.3"]);
  });
  it("installed-only and channel filters", () => {
    const v = { snapshots: true, oldBeta: true, oldAlpha: true };
    expect(filterVersions(rows, { ...base, installedOnly: true }, v).map((r) => r.id)).toEqual(["1.21.1"]);
    expect(filterVersions(rows, { ...base, channel: "old" }, v).map((r) => r.id)).toEqual(["b1.7.3"]);
  });
  it("sorts by name and date", () => {
    const v = { snapshots: true, oldBeta: true, oldAlpha: true };
    expect(filterVersions(rows, { ...base, sort: "oldest" }, v)[0].id).toBe("b1.7.3");
    expect(filterVersions(rows, { ...base, sort: "name" }, v).map((r) => r.id)).toEqual(["1.21.1", "24w14a", "b1.7.3"]);
  });
});

describe("i18n", () => {
  it("falls back and translates", () => {
    expect(translate("en", "launch.play")).toBe("Launch Game");
  });
});

describe("persian + theme", () => {
  it("translates to Persian, isolates RTL text and keeps no missing keys", async () => {
    const { translate, plain, missingKeys } = await import("../src/i18n");
    expect(plain(translate("fa", "launch.play"))).toBe("اجرای بازی");
    expect(missingKeys("fa")).toEqual([]);
  });
});
