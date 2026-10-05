import { describe, expect, it } from "vitest";
import type { Dataset } from "@/lib/repository/types";

import { runNote, runPeriodLabel } from "@/lib/jobs/run-note";
import { fakeDataset, fakeDraft } from "@/lib/workspace/fixtures";

function snapshot(start = "2000-01-01", end = "2009-12-31"): Dataset {
  const base = fakeDataset();
  return fakeDataset({ simulation: { ...base.simulation, temporalCoverage: { start, end } } });
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

describe("runNote", () => {
  const job = (start: string, end: string) =>
    fakeDraft("COMPLETED", {
      parameters: { ...fakeDraft("COMPLETED").parameters, temporal_range_start: start, temporal_range_end: end },
    });

  it("is null when the simulation is the whole period the snapshot covers", () => {
    expect(runNote(job("2000-01-01", "2009-12-31"), snapshot())).toBeNull();
  });

  it("says the run period when the simulation is part of what the snapshot covers", () => {
    expect(runNote(job("2000-01-01", "2005-12-31"), snapshot())).toBe("Run 2000–2005");
    expect(runNote(job("2000-03-01", "2009-12-31"), snapshot())).toBe("Run 2000-03-01 → 2009-12-31");
  });

  it("says the run period when there is no snapshot to compare it with", () => {
    expect(runNote(job("2000-01-01", "2001-12-31"), null)).toBe("Run 2000–2001");
  });

  it("says nothing of a period a draft does not have yet", () => {
    expect(runNote(job("", ""), snapshot())).toBeNull();
  });
});
