import { describe, expect, it } from "vitest";
import { ZIP_LIMIT_BYTES, limitLabel, selectionTotals, type FolderSize } from "./selection";
import type { FolderSummary, TreeFile } from "./types";

const file = (name: string, size: number): TreeFile => ({
  name,
  path: `d/${name}`,
  size,
  lastModified: "2026-10-01T00:00:00Z",
  url: `https://s3.example/${name}`,
  previewable: false,
});

function ready(bytes: number, over: Partial<FolderSummary> = {}): FolderSize {
  return {
    status: "ready",
    summary: { path: "x/", url: "u", files: 3, bytes, limit_bytes: ZIP_LIMIT_BYTES, fits: true, complete: true, ...over },
  };
}

const FILES = [file("a.nc", 100), file("b.nc", 200)];
const MB = 1024 * 1024;

describe("the limit label", () => {
  it("writes the limit as 500 MB", () => {
    expect(limitLabel(ZIP_LIMIT_BYTES)).toBe("500 MB");
    expect(limitLabel(1536 * 1024)).toBe("1.5 MB");
  });
});

describe("a selection's totals", () => {
  it("adds the files' listed sizes at once, with nothing to wait for", () => {
    expect(selectionTotals(["a.nc", "b.nc"], FILES, {})).toEqual({
      count: 2,
      bytes: 300,
      limit: ZIP_LIMIT_BYTES,
      status: "ok",
      failed: [],
    });
  });

  it("is checking while a ticked folder has no summary yet, and adds it when it comes", () => {
    expect(selectionTotals(["a.nc", "x/"], FILES, {}).status).toBe("checking");
    const done = selectionTotals(["a.nc", "x/"], FILES, { "x/": ready(5 * MB) });
    expect(done).toMatchObject({ status: "ok", bytes: 100 + 5 * MB, count: 2 });
  });

  it("is over the limit when the total passes it, and at the limit it is not", () => {
    expect(selectionTotals(["x/"], FILES, { "x/": ready(ZIP_LIMIT_BYTES) }).status).toBe("ok");
    expect(selectionTotals(["a.nc", "x/"], FILES, { "x/": ready(ZIP_LIMIT_BYTES) }).status).toBe("over");
  });

  it("is over as soon as what is known is, with other folders still to be counted", () => {
    const totals = selectionTotals(["x/", "y/"], FILES, { "x/": ready(ZIP_LIMIT_BYTES + 1) });
    expect(totals.status).toBe("over");
  });

  it("counts a folder listed only in part as over, whatever its bytes", () => {
    const totals = selectionTotals(["x/"], FILES, { "x/": ready(10, { complete: false, fits: false }) });
    expect(totals.status).toBe("incomplete");
  });

  it("names the folders whose size could not be had, and says over before failed", () => {
    expect(selectionTotals(["a.nc", "x/"], FILES, { "x/": { status: "failed" } })).toMatchObject({
      status: "failed",
      failed: ["x/"],
    });
    const both = selectionTotals(["x/", "y/"], FILES, {
      "x/": { status: "failed" },
      "y/": ready(ZIP_LIMIT_BYTES + 1),
    });
    expect(both.status).toBe("over");
  });
});
