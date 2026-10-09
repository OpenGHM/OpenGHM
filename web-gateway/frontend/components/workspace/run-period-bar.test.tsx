import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RunPeriodBar, periodBarLayout } from "@/components/workspace/run-period-bar";

afterEach(cleanup);

const COVERAGE = { start: "2000-01-01", end: "2009-12-31" };

describe("periodBarLayout", () => {
  it("puts a year of a ten-year coverage on a tenth of the axis", () => {
    const layout = periodBarLayout(COVERAGE, "2002-01-01", "2002-12-31")!;
    expect(layout.fill!.from).toBeCloseTo(0.2, 2);
    expect(layout.fill!.to).toBeCloseTo(0.3, 2);
  });

  it("fills the whole axis for the whole coverage, and labels every second year from 2000 to 2010", () => {
    const layout = periodBarLayout(COVERAGE, "2000-01-01", "2009-12-31")!;
    expect(layout.fill).toEqual({ from: 0, to: 1 });
    expect(layout.ticks.map((t) => t.year)).toEqual([2000, 2002, 2004, 2006, 2008, 2010]);
    expect(layout.ticks[0].at).toBe(0);
    expect(layout.ticks[5].at).toBe(1);
  });

  it("clips a period that runs outside the coverage", () => {
    const layout = periodBarLayout(COVERAGE, "1990-01-01", "2020-12-31")!;
    expect(layout.fill).toEqual({ from: 0, to: 1 });
  });

  it("draws no period for dates that do not make one", () => {
    expect(periodBarLayout(COVERAGE, "2005-01-01", "2004-12-31")!.fill).toBeNull();
    expect(periodBarLayout(COVERAGE, "", "2004-12-31")!.fill).toBeNull();
    expect(periodBarLayout(COVERAGE, "2001-02-30", "2004-12-31")!.fill).toBeNull();
    expect(periodBarLayout(COVERAGE, "2012-01-01", "2013-12-31")!.fill).toBeNull();
  });

  it("draws nothing when the coverage is not two dates in order", () => {
    expect(periodBarLayout({ start: "", end: "2009-12-31" }, "2000-01-01", "2000-12-31")).toBeNull();
    expect(
      periodBarLayout({ start: "2009-12-31", end: "2000-01-01" }, "2000-01-01", "2000-12-31")
    ).toBeNull();
  });

  it("keeps a long coverage to a few ticks", () => {
    const layout = periodBarLayout({ start: "1900-01-01", end: "2099-12-31" }, "2000-01-01", "2000-12-31")!;
    expect(layout.ticks.length).toBeLessThanOrEqual(6);
    expect(layout.ticks.length).toBeGreaterThan(1);
  });
});

describe("RunPeriodBar", () => {
  it("is hidden from assistive technology and draws the period and the years", () => {
    render(<RunPeriodBar coverage={COVERAGE} start="2000-01-01" end="2001-12-31" />);
    const bar = screen.getByTestId("run-period-bar");
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByTestId("run-period-fill").getAttribute("style")).toMatch(/width: 20\.0\d%/);
    expect(bar.textContent).toBe("200020022004200620082010");
  });

  it("renders nothing without a coverage", () => {
    const { container } = render(<RunPeriodBar coverage={null} start="2000-01-01" end="2001-12-31" />);
    expect(container.firstChild).toBeNull();
  });
});
