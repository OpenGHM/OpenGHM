import { describe, expect, it } from "vitest";
import {
  boxLabel,
  boxProblem,
  defaultPeriod,
  maxSubsetBytes,
  middleBox,
  periodLabel,
  periodQuery,
  periodSteps,
  pickRange,
  refusalMessage,
  s3SyncCommand,
  subsetCommand,
  subsetFilename,
  subsetQuery,
} from "./output";

const GRID = { west: -180, south: -60, east: 180, north: 85 };
const P = (from: number, to: number, monthFrom = 1, monthTo = 12) => ({ from, to, monthFrom, monthTo });

describe("a period", () => {
  it("is asked as years, or as whole months the toolkit reads to their last day", () => {
    expect(periodQuery("yearly", P(2000, 2009))).toEqual({ start: "2000", end: "2009" });
    expect(periodQuery("monthly", P(2000, 2000, 3, 5))).toEqual({ start: "2000-03", end: "2000-05" });
    expect(periodQuery("daily", P(2000, 2001, 11, 2))).toEqual({ start: "2000-11", end: "2001-02" });
  });

  it("counts its steps: years, months, or days with leap years", () => {
    expect(periodSteps("yearly", P(2000, 2009))).toBe(10);
    expect(periodSteps("monthly", P(2000, 2001, 3, 2))).toBe(12);
    expect(periodSteps("daily", P(2000, 2000, 2, 2))).toBe(29);
    expect(periodSteps("daily", P(2001, 2001, 1, 12))).toBe(365);
  });

  it("reads as a span and a count", () => {
    expect(periodLabel("yearly", P(2000, 2009))).toBe("2000 – 2009 · 10 years");
    expect(periodLabel("yearly", P(2004, 2004))).toBe("2004 · 1 year");
    expect(periodLabel("monthly", P(2000, 2000, 1, 3))).toBe("Jan – Mar 2000 · 3 months");
    expect(periodLabel("daily", P(2000, 2000, 1, 1))).toBe("Jan 2000 · 31 days");
    expect(periodLabel("monthly", P(2000, 2001, 11, 2))).toBe("Nov 2000 – Feb 2001 · 4 months");
  });

  it("starts at every year, the first year of months, or the first month of days", () => {
    const years = [2000, 2001, 2002];
    expect(defaultPeriod(years, "yearly")).toEqual(P(2000, 2002));
    expect(defaultPeriod(years, "monthly")).toEqual(P(2000, 2000, 1, 12));
    expect(defaultPeriod(years, "daily")).toEqual(P(2000, 2000, 1, 1));
  });

  it("is picked in two clicks, in either order", () => {
    const first = pickRange({ from: 2000, to: 2009 }, 2005, false);
    expect(first).toEqual({ from: 2005, to: 2005, waiting: true });
    expect(pickRange(first, 2002, true)).toEqual({ from: 2002, to: 2005, waiting: false });
    expect(pickRange(first, 2005, true)).toEqual({ from: 2005, to: 2005, waiting: false });
  });
});

describe("a box", () => {
  it.each([
    [{ west: -112, south: 40, east: -104, north: 46 }, null],
    [{ west: NaN, south: 40, east: -104, north: 46 }, /as a number/],
    [{ west: -112, south: 46, east: -104, north: 40 }, /North must be above South/],
    [{ west: -100, south: 40, east: -104, north: 46 }, /East must be east of West/],
    [{ west: -112, south: 40, east: -104, north: 88 }, /inside the grid/],
  ])("%o is %s", (box, problem) => {
    const found = boxProblem(box, GRID);
    if (problem === null) expect(found).toBeNull();
    else expect(found).toMatch(problem);
  });

  it("starts as the middle quarter of the grid, on quarter degrees, and reads in degrees", () => {
    expect(middleBox(GRID)).toEqual({ west: -90, east: 90, south: -23.75, north: 48.75 });
    expect(boxLabel({ west: -112.25, south: 35, east: -89.25, north: 47 })).toBe("35° N – 47° N, 112.25° W – 89.25° W");
  });
});

describe("a subset", () => {
  it("holds at most steps x rows x cols x 4 bytes", () => {
    // 10 yearly steps over a 6 x 8 degree box of 1/12 degree cells: 72 x 96 cells.
    expect(maxSubsetBytes(10, { west: -112, south: 40, east: -104, north: 46 }, 1 / 12)).toBe(10 * 72 * 96 * 4);
  });

  it("is asked with its box only when there is one", () => {
    const base = { variable: "runoff", resolution: "monthly" as const, period: P(2000, 2000, 1, 3) };
    expect(Object.fromEntries(new URLSearchParams(subsetQuery({ ...base, box: null })))).toEqual({
      variable: "runoff",
      resolution: "monthly",
      start: "2000-01",
      end: "2000-03",
    });
    const boxed = new URLSearchParams(subsetQuery({ ...base, box: { west: -112, south: 40, east: -104, north: 46 } }));
    expect(boxed.get("bbox")).toBe("-112,40,-104,46");
  });

  it("is named for what it holds, and has the same request as a toolkit command", () => {
    expect(subsetFilename("runoff", "yearly", P(2000, 2009), false)).toBe("runoff_yearly_2000_2009.nc");
    expect(subsetFilename("runoff", "daily", P(2000, 2000, 1, 1), true)).toBe("runoff_daily_2000-01_box.nc");
    expect(
      subsetCommand({
        snapshotId: "abc",
        variable: "runoff",
        resolution: "monthly",
        period: P(2000, 2000, 1, 3),
        box: { west: -112, south: 40, east: -104, north: 46 },
        filename: "r.nc",
      })
    ).toBe(
      "openghm output subset --snapshot abc --var runoff --resolution monthly --start 2000-01 --end 2000-03 --bbox -112,40,-104,46 --format nc --out r.nc"
    );
  });
});

describe("a folder at once", () => {
  it("is an anonymous aws s3 sync against the bucket's own endpoint", () => {
    expect(
      s3SyncCommand("https://s3.anvil.rcac.purdue.edu/openghm/snapshots/abc/", "wbm_output/G/", "./wbm_output")
    ).toBe(
      "aws s3 sync --no-sign-request --endpoint-url https://s3.anvil.rcac.purdue.edu s3://openghm/snapshots/abc/wbm_output/G/ ./wbm_output"
    );
  });
});

describe("a refusal", () => {
  it("is explained in the toolkit's words, from either shape, starting with a capital", () => {
    expect(refusalMessage({ detail: { code: "output_request_refused", message: "this request reads too much" } })).toBe(
      "This request reads too much"
    );
    expect(refusalMessage({ detail: "Dataset 'x' not found" })).toBe("Dataset 'x' not found");
    expect(refusalMessage({ code: "gateway_unreachable", message: "The gateway could not reach its backend." })).toBe(
      "The gateway could not reach its backend."
    );
    expect(refusalMessage(null)).toBeNull();
  });
});
