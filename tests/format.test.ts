import { describe, expect, it } from "vitest";
import { pct, matchesExact } from "../src/lib/format";

describe("progress", () => {
  it("uses bytes when known, falls back to files, null when unknown", () => {
    expect(pct({ doneBytes: 50, totalBytes: 200, doneFiles: 0, totalFiles: 0 })).toBe(25);
    expect(pct({ doneBytes: 0, totalBytes: 0, doneFiles: 1, totalFiles: 4 })).toBe(25);
    expect(pct({ doneBytes: 0, totalBytes: 0, doneFiles: 0, totalFiles: 0 })).toBeNull();
  });
  it("never reports more than 100%", () => {
    expect(pct({ doneBytes: 300, totalBytes: 200, doneFiles: 0, totalFiles: 0 })).toBe(100);
  });
  it("exact match helper", () => {
    expect(matchesExact("1.21.1", " 1.21.1 ")).toBe(true);
    expect(matchesExact("1.21.1", "1.21")).toBe(false);
  });
});
