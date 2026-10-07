import { describe, expect, it } from "vitest";
import {
  displayText,
  folderCrumbs,
  normalizeFolder,
  parentFolder,
  treeBaseUrl,
  treeFailureCode,
  treeHref,
  treeRoute,
} from "./tree-browse";
import type { TreeFile } from "./types";

function file(path: string, url: string): TreeFile {
  return { name: path.split("/").pop() ?? path, path, size: 1, lastModified: "2026-10-01T00:00:00Z", url, previewable: true };
}

describe("treeRoute", () => {
  it("names the snapshot route `datasets` and the model input route `model-inputs`", () => {
    expect(treeRoute("snapshot", "abc")).toBe("/api/v1/repository/datasets/abc");
    expect(treeRoute("model_input", "a b")).toBe("/api/v1/repository/model-inputs/a%20b");
  });
});

describe("folders", () => {
  it("normalizeFolder gives the root as an empty string and adds the trailing slash", () => {
    expect(normalizeFolder(null)).toBe("");
    expect(normalizeFolder("")).toBe("");
    expect(normalizeFolder("wbm_output")).toBe("wbm_output/");
    expect(normalizeFolder("wbm_output/")).toBe("wbm_output/");
  });

  it("parentFolder is the folder a file is in", () => {
    expect(parentFolder("a/b/c.txt")).toBe("a/b/");
    expect(parentFolder("metadata.json")).toBe("");
  });

  it("folderCrumbs lists every folder from the root down", () => {
    expect(folderCrumbs("")).toEqual([]);
    expect(folderCrumbs("a/b/")).toEqual([
      { name: "a", path: "a/" },
      { name: "b", path: "a/b/" },
    ]);
  });
});

describe("treeHref", () => {
  it("is the page itself at the root, and keeps `/` readable in the query", () => {
    expect(treeHref("/repository/x/files", "")).toBe("/repository/x/files");
    expect(treeHref("/repository/x/files", "wbm_output/daily/")).toBe(
      "/repository/x/files?path=wbm_output/daily/"
    );
    expect(treeHref("/repository/x/files", "wbm_init/", "wbm_init/a b.init")).toBe(
      "/repository/x/files?path=wbm_init/&file=wbm_init/a%20b.init"
    );
  });
});

describe("treeBaseUrl", () => {
  it("is a listed file's URL without its path", () => {
    const files = [file("a/b.txt", "https://s3.example/bkt/snapshots/x/a/b.txt")];
    expect(treeBaseUrl(files)).toBe("https://s3.example/bkt/snapshots/x/");
  });

  it("is null when no file tells", () => {
    expect(treeBaseUrl([])).toBeNull();
    expect(treeBaseUrl([file("a.txt", "https://s3.example/other")])).toBeNull();
  });
});

describe("displayText", () => {
  it("pretty-prints a .json file that parses", () => {
    expect(displayText("m.json", '{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it("leaves a .json file that does not parse, and any other file, as it is", () => {
    expect(displayText("m.json", '{"a":')).toBe('{"a":');
    expect(displayText("m.init", '{"a":1}')).toBe('{"a":1}');
  });
});

describe("treeFailureCode", () => {
  const failure = (status: number, detail?: unknown) => ({ response: { status, data: { detail } } });

  it("reads the backend's code", () => {
    expect(treeFailureCode(failure(422, { code: "invalid_path", message: "x" }), "listing_unavailable")).toBe("invalid_path");
    expect(treeFailureCode(failure(404, { code: "path_not_found", message: "x" }), "listing_unavailable")).toBe("path_not_found");
    expect(treeFailureCode(failure(503, { code: "preview_unavailable", message: "x" }), "listing_unavailable")).toBe("preview_unavailable");
  });

  it("takes a plain 404 for an id the catalogue does not hold", () => {
    expect(treeFailureCode(failure(404, "Not Found"), "listing_unavailable")).toBe("not_found");
  });

  it("falls back to the route's own unavailable code for anything else", () => {
    expect(treeFailureCode(failure(500), "preview_unavailable")).toBe("preview_unavailable");
    expect(treeFailureCode(failure(503, { code: "something_else" }), "listing_unavailable")).toBe("listing_unavailable");
    expect(treeFailureCode(new Error("connect ECONNREFUSED"), "listing_unavailable")).toBe("listing_unavailable");
  });
});
