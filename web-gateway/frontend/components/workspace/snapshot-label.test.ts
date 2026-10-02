import { describe, expect, it } from "vitest";
import {
  snapshotBox,
  snapshotExtent,
  snapshotName,
  snapshotResolution,
  snapshotYears,
} from "@/components/workspace/snapshot-label";
import { fakeDataset } from "@/lib/workspace/fixtures";
import type { Dataset } from "@/lib/repository/types";

const LONG_TITLE =
  "WBM v1.0.0 Global_tracking simulation for 'Water balance model (WBM) v.1.0.0: a scalable gridded global hydrologic model with water-tracking functionality': [Global] [2000-2009]";

function snapshot(over: {
  version?: string;
  start?: string;
  end?: string;
  box?: { northlimit: number; southlimit: number; eastlimit: number; westlimit: number };
  name?: string;
}): Dataset {
  const base = fakeDataset();
  return fakeDataset({
    about: { ...base.about, name: over.name ?? base.about.name },
    uses: { ...base.uses, container: { ...base.uses.container, version: over.version ?? "1.0.0" } },
    simulation: {
      ...base.simulation,
      resolution: { value: 5, unit: "arc-minute" },
      temporalCoverage: { start: over.start ?? "2000-01-01", end: over.end ?? "2009-12-31" },
      spatialCoverage: { ...base.simulation.spatialCoverage, ...(over.box ?? {}) },
    },
  });
}

describe("a snapshot's short name", () => {
  it("is the model, its version and the years it covers, from metadata fields", () => {
    expect(snapshotName(snapshot({}))).toBe("WBM 1.0.0 · 2000–2009");
    expect(snapshotName(snapshot({ version: "2.0.0", end: "2001-12-31" }))).toBe("WBM 2.0.0 · 2000–2001");
  });

  it("does not depend on the official title", () => {
    expect(snapshotName(snapshot({ name: LONG_TITLE }))).toBe(snapshotName(snapshot({ name: "Anything" })));
  });

  it("writes one year once", () => {
    const one = snapshot({ start: "2001-01-01", end: "2001-12-31" });
    expect(snapshotYears(one)).toBe("2001");
    expect(snapshotName(one)).toBe("WBM 1.0.0 · 2001");
  });
});

describe("the rest of what the workspace says about a snapshot", () => {
  it("says Global or Regional from the box, the word the repository's map carries", () => {
    const world = { northlimit: 85, southlimit: -60, eastlimit: 180, westlimit: -180 };
    const conus = { northlimit: 57.1667, southlimit: 21.75, eastlimit: -60.5833, westlimit: -127.8333 };
    expect(snapshotExtent(snapshot({ box: world }))).toBe("Global");
    expect(snapshotExtent(snapshot({ box: conus }))).toBe("Regional");
    expect(snapshotBox(snapshot({ box: conus }))).toEqual({
      north: 57.1667,
      south: 21.75,
      east: -60.5833,
      west: -127.8333,
    });
  });

  it("writes the resolution the way the filter chips do", () => {
    expect(snapshotResolution(snapshot({}))).toBe("5 arc-min");
  });
});
