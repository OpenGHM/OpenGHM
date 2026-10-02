import { describe, expect, it } from "vitest";
import { describeRunPeriodLimits } from "@/lib/jobs/run-period";
import { fakeDataset } from "@/lib/workspace/fixtures";

const snapshot = (over: { start: string; end: string }, extra: Parameters<typeof fakeDataset>[0] = {}) =>
  fakeDataset({
    simulation: { ...fakeDataset().simulation, temporalCoverage: over },
    ...extra,
  });

describe("the run period's limits, as one line", () => {
  it("says the start rule, the aggregation's end, and the coverage once", () => {
    const line = describeRunPeriodLimits(
      snapshot({ start: "2000-01-01", end: "2001-12-31" }, { runStartAlignment: "year", aggregationStartYear: 2001 })
    );
    expect(line).toBe("Start on January 1 · End on 2001-12-31 · Coverage 2000-01-01 → 2001-12-31");
  });

  it("says 'on or after' when the coverage runs past the aggregation year", () => {
    const line = describeRunPeriodLimits(
      snapshot({ start: "2000-01-01", end: "2004-12-31" }, { runStartAlignment: "year", aggregationStartYear: 2001 })
    );
    expect(line).toBe(
      "Start on January 1, no later than 2001-12-31 · End on or after 2001-12-31 · Coverage 2000-01-01 → 2004-12-31"
    );
  });

  it("is the coverage alone when the model sets no rule", () => {
    expect(
      describeRunPeriodLimits(
        snapshot({ start: "2000-01-01", end: "2009-12-31" }, { runStartAlignment: "none", aggregationStartYear: null })
      )
    ).toBe("Coverage 2000-01-01 → 2009-12-31");
  });

  it("names a month rule, and says when the start could not be checked", () => {
    expect(
      describeRunPeriodLimits(snapshot({ start: "2000-01-01", end: "2009-12-31" }, { runStartAlignment: "month" }))
    ).toContain("Start on the 1st of a month");
    expect(
      describeRunPeriodLimits(snapshot({ start: "2000-01-01", end: "2009-12-31" }, { runStartAlignment: null }))
    ).toBe("Start date not checked here · Coverage 2000-01-01 → 2009-12-31");
  });

  it("says nothing without a snapshot", () => {
    expect(describeRunPeriodLimits(null)).toBeNull();
  });
});
