import { describe, expect, it } from "vitest";
import { formatBytes, purgeAround } from "@/lib/workspace/format";
import { groupManifest, limitRows } from "@/lib/workspace/manifest";

describe("groupManifest", () => {
  it("groups by top folder and lists top-level files last", () => {
    const groups = groupManifest([
      { path: "init.ini", bytes: 10 },
      { path: "daily/a_2001.nc", bytes: 100 },
      { path: "monthly/a_2001.nc", bytes: 30 },
      { path: "daily/a_2002.nc", bytes: 100 },
    ]);
    expect(groups.map((g) => g.folder)).toEqual(["daily", "monthly", ""]);
    expect(groups[0]).toMatchObject({ fileCount: 2, totalBytes: 200 });
    expect(groups[0].files[1].name).toBe("a_2002.nc");
  });

  it("keeps deeper paths under their top folder", () => {
    const [g] = groupManifest([{ path: "daily/2001/a.nc", bytes: 1 }]);
    expect(g.files[0].name).toBe("2001/a.nc");
  });

  it("returns nothing for an empty manifest", () => {
    expect(groupManifest([])).toEqual([]);
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [4096, "4.0 KB"],
    [184_320_000, "175.8 MB"],
  ])("%d is %s", (n, text) => expect(formatBytes(n)).toBe(text));
});

describe("purgeAround", () => {
  it("is 30 days after the job ended", () => {
    expect(purgeAround("2026-09-01T00:00:00.000Z")).toBe("2026-10-01T00:00:00.000Z");
  });
  it("is unknown without an end time", () => {
    expect(purgeAround(null)).toBeNull();
  });
});

describe("limitRows", () => {
  it("cuts rows across groups but keeps each group's real totals", () => {
    const groups = groupManifest([
      { path: "a/1.nc", bytes: 1 },
      { path: "a/2.nc", bytes: 1 },
      { path: "b/3.nc", bytes: 1 },
    ]);
    const shown = limitRows(groups, 3);
    expect(shown.map((g) => g.rows.length)).toEqual([2, 1]);
    const cut = limitRows(groups, 1);
    expect(cut.map((g) => g.rows.length)).toEqual([1, 0]);
    expect(cut[0].fileCount).toBe(2);
  });
});
