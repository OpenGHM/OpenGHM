import { describe, expect, it } from "vitest";
import { runPeriodLabel } from "@/lib/jobs/run-period-label";

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
