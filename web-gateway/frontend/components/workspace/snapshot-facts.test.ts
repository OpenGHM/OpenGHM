import { describe, expect, it } from "vitest";
import { snapshotBox, snapshotFacts } from "@/components/workspace/snapshot-facts";
import { fakeDataset } from "@/lib/workspace/fixtures";
import type { Dataset } from "@/lib/repository/types";

function snapshot(over: { version?: string; start?: string; end?: string; name?: string } = {}): Dataset {
  const base = fakeDataset();
  return fakeDataset({
    about: { ...base.about, name: over.name ?? base.about.name },
    uses: { ...base.uses, container: { ...base.uses.container, version: over.version ?? "1.0.0" } },
    simulation: {
      ...base.simulation,
      resolution: { value: 5, unit: "arc-minute" },
      temporalCoverage: { start: over.start ?? "2000-01-01", end: over.end ?? "2009-12-31" },
      spatialCoverage: { ...base.simulation.spatialCoverage, northlimit: 57.5, southlimit: 21.5, eastlimit: -60, westlimit: -127 },
    },
  });
}

describe("a snapshot's facts", () => {
  it("are the model and version, the years and the resolution, each its own phrase", () => {
    expect(snapshotFacts(snapshot())).toEqual(["WBM 1.0.0", "2000–2009", "5 arc-min"]);
    expect(snapshotFacts(snapshot({ version: "2.0.0", end: "2001-12-31" }))).toEqual([
      "WBM 2.0.0",
      "2000–2001",
      "5 arc-min",
    ]);
  });

  it("write one year once", () => {
    expect(snapshotFacts(snapshot({ start: "2001-01-01", end: "2001-12-31" }))[1]).toBe("2001");
  });

  it("do not depend on the title, and never say Global or Regional", () => {
    expect(snapshotFacts(snapshot({ name: "[Global] anything" }))).toEqual(snapshotFacts(snapshot({ name: "Other" })));
    expect(snapshotFacts(snapshot()).join(" ")).not.toMatch(/Global|Regional/);
  });
});

describe("a snapshot's box", () => {
  it("is what the thumbnail draws", () => {
    expect(snapshotBox(snapshot())).toEqual({ north: 57.5, south: 21.5, east: -60, west: -127 });
  });
});
