import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { TemporalTimeline, timelineAxis } from "@/components/repository/temporal-timeline";

afterEach(cleanup);

describe("timelineAxis", () => {
  it("puts a decade in the middle of a 1980 to 2020 scale", () => {
    const axis = timelineAxis("2000-01-01", "2009-12-31")!;
    expect(axis.ticks).toEqual([1980, 1990, 2000, 2010, 2020]);
    expect(axis.left).toBe(50);
    expect(axis.width).toBeCloseTo(25, 0);
    expect([...axis.lit]).toEqual([2000, 2010]);
  });

  it("keeps a one-year coverage on the same scale, as a thin bar", () => {
    const axis = timelineAxis("2000-01-01", "2001-12-31")!;
    expect(axis.ticks).toEqual([1980, 1990, 2000, 2010, 2020]);
    expect(axis.left).toBe(50);
    expect(axis.width).toBeCloseTo(5, 0);
  });

  it("widens the step when the coverage does not fit", () => {
    const axis = timelineAxis("1950-01-01", "2020-12-31")!;
    expect(axis.ticks).toEqual([1850, 1900, 1950, 2000, 2050]);
    expect(axis.left).toBe(50);
    expect(axis.width).toBeCloseTo(35.5, 0);
  });

  it("is null for a value that is not a date", () => {
    expect(timelineAxis("someday", "2009-12-31")).toBeNull();
    expect(timelineAxis("2000-01-01", "")).toBeNull();
  });
});

describe("TemporalTimeline", () => {
  it("draws the years and is hidden from assistive technology", () => {
    const { container } = render(<TemporalTimeline start="2000-01-01" end="2009-12-31" />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent).toBe("19801990200020102020");
  });

  it("draws nothing for a value that is not a date", () => {
    const { container } = render(<TemporalTimeline start="x" end="y" />);
    expect(container.firstChild).toBeNull();
  });
});
