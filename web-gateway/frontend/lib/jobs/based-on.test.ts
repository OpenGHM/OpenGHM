import { describe, expect, it } from "vitest";
import type { Dataset } from "@/lib/repository/types";

import { basedOnLabel, runPeriodLabel, simulationMetaLine } from "@/lib/jobs/based-on";
import { fakeDataset, fakeSimulation } from "@/lib/workspace/fixtures";

const WORLD = { northlimit: 85, southlimit: -60, eastlimit: 180, westlimit: -180, units: "Decimal degrees", projection: "EPSG:4326" } as const;

function snapshot(over: { box?: Dataset["simulation"]["spatialCoverage"]; start?: string; end?: string; version?: string } = {}): Dataset {
  const base = fakeDataset();
  return fakeDataset({
    simulation: {
      ...base.simulation,
      spatialCoverage: over.box ?? base.simulation.spatialCoverage,
      temporalCoverage: { start: over.start ?? "2000-01-01", end: over.end ?? "2009-12-31" },
    },
    uses: { ...base.uses, container: { ...base.uses.container, version: over.version ?? "1.0.0" } },
  });
}

describe("runPeriodLabel", () => {
  it("writes whole years as a range, and one year once", () => {
    expect(runPeriodLabel("2000-01-01", "2001-12-31")).toBe("2000–2001");
    expect(runPeriodLabel("2001-01-01", "2001-12-31")).toBe("2001");
  });

  it("keeps the dates of a partial year, never rounding them to a whole one", () => {
    expect(runPeriodLabel("2000-03-01", "2000-12-31")).toBe("2000-03-01 → 2000-12-31");
    expect(runPeriodLabel("2000-01-01", "2000-06-30")).toBe("2000-01-01 → 2000-06-30");
  });

  it("is null until both dates are set", () => {
    expect(runPeriodLabel("", "")).toBeNull();
    expect(runPeriodLabel("2000-01-01", "")).toBeNull();
    expect(runPeriodLabel(null, undefined)).toBeNull();
  });
});

describe("basedOnLabel", () => {
  it("is the model, version and years, then whether it is global or regional (from the box)", () => {
    expect(basedOnLabel(snapshot({ box: WORLD }))).toBe("WBM 1.0.0 · 2000–2009 · Global");
    expect(basedOnLabel(snapshot({ version: "2.0.0", end: "2001-12-31" }))).toBe("WBM 2.0.0 · 2000–2001 · Regional");
  });
});

describe("simulationMetaLine", () => {
  const job = (start: string, end: string) =>
    fakeSimulation("COMPLETED", { parameters: { ...fakeSimulation("COMPLETED").parameters, temporal_range_start: start, temporal_range_end: end } });

  it("leaves the run period out when it is the whole period the snapshot covers", () => {
    expect(simulationMetaLine(job("2000-01-01", "2009-12-31"), snapshot({ box: WORLD }))).toBe(
      "WBM 1.0.0 · 2000–2009 · Global"
    );
  });

  it("adds the run period when the run is part of what the snapshot covers", () => {
    expect(simulationMetaLine(job("2000-01-01", "2005-12-31"), snapshot({ box: WORLD }))).toBe(
      "WBM 1.0.0 · 2000–2009 · Global · Run 2000–2005"
    );
  });

  it("falls back to the title the job recorded when the snapshot cannot be read, and still says the run period", () => {
    const j = { ...job("2000-01-01", "2001-12-31"), dataset_title: "WBM v2.0.0 tutorial" };
    expect(simulationMetaLine(j, null)).toBe("WBM v2.0.0 tutorial · Run 2000–2001");
  });

  it("says nothing of a run period a draft does not have yet", () => {
    expect(simulationMetaLine(job("", ""), snapshot())).toBe("WBM 1.0.0 · 2000–2009 · Regional");
  });
});
