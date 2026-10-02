import { describe, expect, it } from "vitest";
import {
  aggregationMessages,
  checkAggregationWindow,
  checkAggregationWindowFor,
} from "@/lib/jobs/aggregation-window";
import { fakeDataset } from "@/lib/workspace/fixtures";

// The v2.0.0 CONUS snapshot: 2000-01-01 .. 2001-12-31, multi-year aggregation from 2001.
const LO = "2000-01-01";
const HI = "2001-12-31";

describe("the multi-year aggregation window", () => {
  it("refuses the run that failed on Anvil on its end, naming the allowed range", () => {
    const problems = checkAggregationWindow(2001, "2000-01-01", "2000-12-31", LO, HI);
    expect(problems.start).toBeNull();
    expect(problems.end).toBe(
      "This snapshot's model also aggregates its results over multi-year periods that begin in 2001, so a run must end on or after 2001-12-31 (allowed: 2001-12-31 to 2001-12-31)."
    );
  });

  it("refuses a start after the window's year", () => {
    const problems = checkAggregationWindow(2001, "2002-01-01", "2002-12-31", LO, HI);
    expect(problems.end).toBeNull();
    expect(problems.start).toContain("a run can start no later than 2001-12-31 (allowed: 2000-01-01 to 2001-12-31).");
  });

  it("passes dates that reach the window's year", () => {
    for (const [s, e] of [
      ["2000-01-01", "2001-12-31"],
      ["2001-01-01", "2001-12-31"],
      ["2000-01-01", "2002-06-30"],
      // 360-day calendar's last day: the init does not say, WBM decides.
      ["2000-01-01", "2001-12-30"],
    ]) {
      expect(checkAggregationWindow(2001, s, e, LO, HI)).toEqual({ start: null, end: null });
    }
  });

  it("holds a date equal to the snapshot's own to nothing, like the toolkit", () => {
    expect(checkAggregationWindow(2001, "2000-01-01", "2000-12-31", "2000-01-01", "2000-12-31")).toEqual({
      start: null,
      end: null,
    });
    expect(checkAggregationWindow(2001, "2000-01-01", "2000-12-31", "2000-01-01", HI).end).not.toBeNull();
  });

  it("blocks nothing without a window, and leaves non-dates to the date field", () => {
    expect(checkAggregationWindow(null, "2090-01-01", "1990-01-01")).toEqual({ start: null, end: null });
    expect(checkAggregationWindow(undefined, "2090-01-01", "1990-01-01")).toEqual({ start: null, end: null });
    expect(checkAggregationWindow(2001, "", "2000-02-30")).toEqual({ start: null, end: null });
  });

  it("leaves the range out where the coverage cannot hold it", () => {
    expect(aggregationMessages(2005, LO, HI).end).toMatch(/a run must end on or after 2005-12-31\.$/);
  });

  it("reads the year and the coverage from the snapshot", () => {
    const snapshot = fakeDataset({
      aggregationStartYear: 2001,
      simulation: { ...fakeDataset().simulation, temporalCoverage: { start: LO, end: HI } },
    });
    expect(checkAggregationWindowFor(snapshot, "2000-01-01", "2000-12-31").end).toContain("2001-12-31");
    expect(checkAggregationWindowFor(fakeDataset({ aggregationStartYear: null }), "2000-01-01", "2000-12-31")).toEqual({
      start: null,
      end: null,
    });
    expect(checkAggregationWindowFor(null, "2000-01-01", "2000-12-31")).toEqual({ start: null, end: null });
  });
});
