import { describe, expect, it } from "vitest";
import { checkRunStart, nearestValidStart, runStartRulePhrase } from "@/lib/jobs/run-start";

describe("the run-start rule", () => {
  it("says the rule as a phrase, and nothing when there is none", () => {
    expect(runStartRulePhrase("year")).toBe("start on January 1");
    expect(runStartRulePhrase("month")).toBe("start on the 1st of a month");
    expect(runStartRulePhrase("none")).toBeNull();
    expect(runStartRulePhrase(null)).toBeNull();
  });

  it("wants January 1 for a year, and the first of a month for a month", () => {
    expect(checkRunStart("year", "2001-01-01")).toBeNull();
    for (const bad of ["2001-03-01", "2001-01-02", "2001-12-31"]) {
      expect(checkRunStart("year", bad)?.message).toContain("one file per year");
      expect(checkRunStart("year", bad)?.short).toBe("Start on January 1.");
    }
    expect(checkRunStart("month", "2001-03-01")).toBeNull();
    expect(checkRunStart("month", "2001-03-02")?.suggestion).toBe("2001-03-01");
  });

  it("blocks nothing without a rule or an answer", () => {
    expect(checkRunStart("none", "2001-03-17")).toBeNull();
    expect(checkRunStart(null, "2001-03-17")).toBeNull();
  });

  it("leaves a start that is not a real date to the date field", () => {
    expect(checkRunStart("year", "")).toBeNull();
    expect(checkRunStart("year", "2001-02-30")).toBeNull();
    expect(checkRunStart("year", "2001-3-1")).toBeNull();
  });

  it("allows the snapshot's own start, as the toolkit checks an override only", () => {
    expect(checkRunStart("year", "2001-03-01", "2001-03-01", "2001-12-31")).toBeNull();
  });

  it("suggests the nearest allowed start inside the snapshot's coverage", () => {
    expect(nearestValidStart("year", "2000-03-01")).toBe("2000-01-01");
    expect(nearestValidStart("year", "2000-09-01")).toBe("2001-01-01");
    expect(nearestValidStart("year", "2000-02-15")).toBe("2000-01-01");
    expect(nearestValidStart("month", "2000-12-20")).toBe("2001-01-01");
    expect(nearestValidStart("month", "2000-03-10")).toBe("2000-03-01");
    expect(nearestValidStart("year", "2000-09-01", "2000-01-01", "2000-12-31")).toBe("2000-01-01");
    expect(nearestValidStart("year", "2000-03-01", "2000-02-01", "2000-12-31")).toBeNull();
    expect(nearestValidStart("none", "2000-03-01")).toBeNull();
    expect(checkRunStart("year", "2000-09-01")?.suggestion).toBe("2001-01-01");
  });
});
