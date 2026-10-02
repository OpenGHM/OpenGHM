import { describe, expect, it } from "vitest";
import { modelInputItem, mineItem, snapshotItem } from "@/components/repository/catalogue.fixtures";
import { countByKind, filterByKind, kindFromParam, kindHref } from "./my-data";

const SNAP = mineItem(snapshotItem());
const INPUT = mineItem(modelInputItem());

describe("kindFromParam", () => {
  it.each([
    ["snapshot", "snapshot"],
    ["model-input", "model-input"],
    ["all", "all"],
    [null, "all"],
    [undefined, "all"],
    ["", "all"],
    ["Snapshot", "all"],
    ["models", "all"],
  ] as const)("reads %j as %s", (param, kind) => {
    expect(kindFromParam(param)).toBe(kind);
  });
});

describe("kindHref", () => {
  it("is the bare page for all, and carries the kind otherwise", () => {
    expect(kindHref("all")).toBe("/workspace/data");
    expect(kindHref("snapshot")).toBe("/workspace/data?kind=snapshot");
    expect(kindHref("model-input")).toBe("/workspace/data?kind=model-input");
  });
});

describe("filterByKind and countByKind", () => {
  const items = [SNAP, INPUT, mineItem(snapshotItem({ id: "snap-2" }))];

  it("keeps everything for all, and one kind otherwise, in order", () => {
    expect(filterByKind(items, "all")).toEqual(items);
    expect(filterByKind(items, "snapshot").map((i) => i.id)).toEqual(["snap-1", "snap-2"]);
    expect(filterByKind(items, "model-input").map((i) => i.id)).toEqual(["mi-1"]);
  });

  it("counts each kind, and all", () => {
    expect(countByKind(items)).toEqual({ all: 3, snapshot: 2, "model-input": 1 });
    expect(countByKind([])).toEqual({ all: 0, snapshot: 0, "model-input": 0 });
  });
});
