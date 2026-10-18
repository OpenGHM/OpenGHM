import { describe, expect, it } from "vitest";
import { ZIP_LIMIT_BYTES, limitLabel, selectionS3Command, selectionTotals, type FolderSize } from "./selection";
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

describe("the S3 command for a selection", () => {
  const TREE = "https://s3.example/openghm/snapshots/abc/";
  const at = (path: string): TreeFile => ({ ...file(path.split("/").pop()!, 1), path, url: TREE + path });
  const SYNC = "aws s3 sync --no-sign-request --endpoint-url https://s3.example";

  it("syncs one ticked folder as it is, into a folder of its name", () => {
    const command = selectionS3Command({
      id: "abc",
      folder: "wbm_output/G/",
      names: ["daily/"],
      files: [at("wbm_output/G/a.nc")],
      sizes: {},
    });
    expect(command).toBe(`${SYNC} s3://openghm/snapshots/abc/wbm_output/G/daily/ ./daily`);
  });

  it("syncs the viewed folder with filters for folders and files together, in the order ticked", () => {
    const command = selectionS3Command({
      id: "abc",
      folder: "wbm_output/G/",
      names: ["daily/", "a.nc", "monthly/"],
      files: [at("wbm_output/G/a.nc")],
      sizes: {},
    });
    expect(command).toBe(
      `${SYNC} s3://openghm/snapshots/abc/wbm_output/G/ ./G --exclude "*" --include "daily/*" --include "a.nc" --include "monthly/*"`
    );
  });

  it("filters a lone file the same way", () => {
    const command = selectionS3Command({ id: "abc", folder: "x/", names: ["a.nc"], files: [at("x/a.nc")], sizes: {} });
    expect(command).toBe(`${SYNC} s3://openghm/snapshots/abc/x/ ./x --exclude "*" --include "a.nc"`);
  });

  it("goes into a folder named for the artifact at the tree's root", () => {
    const command = selectionS3Command({
      id: "abc",
      folder: "",
      names: ["a.nc", "b.nc"],
      files: [at("a.nc"), at("b.nc")],
      sizes: {},
    });
    expect(command).toBe(`${SYNC} s3://openghm/snapshots/abc/ ./abc --exclude "*" --include "a.nc" --include "b.nc"`);
  });

  it("quotes what the shell would read: a space, a quote, a dollar sign, a backtick, a backslash", () => {
    const command = selectionS3Command({
      id: "abc",
      folder: "my runs/",
      names: ['say "hi" $HOME `x` \\.nc', "plain.nc"],
      files: [at("my runs/plain.nc")],
      sizes: {},
    });
    expect(command).toBe(
      `${SYNC} "s3://openghm/snapshots/abc/my runs/" "./my runs" --exclude "*" ` +
        '--include "say \\"hi\\" \\$HOME \\`x\\` \\\\.nc" --include "plain.nc"'
    );
  });

  it("finds the viewed folder from a ticked folder's summary when no file is loaded", () => {
    const command = selectionS3Command({
      id: "abc",
      folder: "wbm_output/G/",
      names: ["daily/", "monthly/"],
      files: [],
      sizes: { "daily/": ready(1, { path: "wbm_output/G/daily/", url: TREE + "wbm_output/G/daily/" }) },
    });
    expect(command).toBe(
      `${SYNC} s3://openghm/snapshots/abc/wbm_output/G/ ./G --exclude "*" --include "daily/*" --include "monthly/*"`
    );
  });

  it("is null when no URL is known: no file loaded, no summary that ends with a ticked folder", () => {
    const none = { id: "abc", folder: "d/", files: [], sizes: {} };
    expect(selectionS3Command({ ...none, names: ["daily/"] })).toBeNull();
    expect(selectionS3Command({ ...none, names: [] })).toBeNull();
    expect(selectionS3Command({ ...none, names: ["daily/"], sizes: { "daily/": { status: "failed" } } })).toBeNull();
    expect(selectionS3Command({ ...none, names: ["daily/"], sizes: { "daily/": ready(1) } })).toBeNull(); // url "u"
    // Files whose URL does not end with their path say nothing about the tree.
    expect(selectionS3Command({ ...none, names: ["a.nc"], files: [file("a.nc", 1)] })).toBeNull();
  });
});
