import { describe, expect, it } from "vitest";
import type { OutputInventory } from "@/lib/repository/output";
import {
  EMPTY_VIEW,
  climatologyKinds,
  convertDate,
  describeProblem,
  downloadOptions,
  filterSeries,
  mapQuery,
  niceTicks,
  offeredResolutions,
  parseView,
  resolveView,
  seriesCsv,
  seriesQuery,
  stepsFor,
  styleProblem,
  writeView,
} from "./view";

const inventory: OutputInventory = {
  grid: { bounds: { west: -10, south: 30, east: 10, north: 50 }, cellSize: 0.5 },
  resolutions: {
    yearly: { years: [2000, 2001, 2002], first: "2000-07-01", last: "2002-07-01" },
    monthly: { years: [2001, 2002], first: "2001-03-16", last: "2002-06-16" },
    climatology: { kinds: ["monthly"] },
  },
  variables: [
    { name: "runoff", longName: "Runoff", units: "mm", resolutions: { yearly: { years: [2000, 2001, 2002] }, monthly: { years: [2001, 2002] }, climatology: { monthly: {} } } },
    { name: "snow", longName: null, units: null, resolutions: { monthly: { years: [2002] } } },
  ],
  ramps: ["DarkBlue", "Rainbow"],
};

describe("the view's state in the URL", () => {
  it("round-trips every part and keeps other keys", () => {
    const state = {
      variable: "runoff",
      resolution: "monthly" as const,
      date: "2001-05",
      ramp: "DarkBlue",
      min: 0.5,
      max: 20,
      log: true,
      point: { lon: -89.123456, lat: 40.25 },
      offset: 11,
      step: 12,
    };
    const written = writeView(state, new URLSearchParams("tab=x&ovar=old"));
    expect(written.get("tab")).toBe("x");
    expect(parseView(written)).toEqual({ ...state, point: { lon: -89.1235, lat: 40.25 } });
  });

  it("leaves defaults out of the URL and reads an empty one as the empty view", () => {
    expect(writeView(EMPTY_VIEW, new URLSearchParams("ovar=a&ooff=3")).toString()).toBe("");
    expect(parseView(new URLSearchParams(""))).toEqual(EMPTY_VIEW);
  });

  it("drops what is malformed", () => {
    const parsed = parseView(
      new URLSearchParams("ovar=../x&ores=hourly&odate=yesterday&omin=abc&opoint=1,2,3&ooff=-4&ostep=0&olog=maybe&oramp=a/b")
    );
    expect(parsed).toEqual(EMPTY_VIEW);
    expect(parseView(new URLSearchParams("opoint=500,2")).point).toBeNull();
  });
});

describe("what the inventory offers", () => {
  it("lists only the resolutions a variable has, and its climatology apart", () => {
    expect(offeredResolutions(inventory.variables[0])).toEqual(["yearly", "monthly"]);
    expect(offeredResolutions(inventory.variables[1])).toEqual(["monthly"]);
    expect(climatologyKinds(inventory.variables[0])).toEqual(["monthly"]);
    expect(climatologyKinds(inventory.variables[1])).toEqual([]);
  });

  it("builds the steps and clips them to the time axis", () => {
    expect(stepsFor("yearly", [2001, 2000])).toEqual(["2000", "2001"]);
    expect(stepsFor("monthly", [2001], "2001-03-16", "2001-06-16")).toEqual(["2001-03", "2001-04", "2001-05", "2001-06"]);
    const days = stepsFor("daily", [2000]);
    expect(days).toHaveLength(366);
    expect(days[59]).toBe("2000-02-29");
  });

  it("starts at the latest yearly step, and falls back to what exists", () => {
    const first = resolveView(EMPTY_VIEW, inventory)!;
    expect([first.variable.name, first.resolution, first.date]).toEqual(["runoff", "yearly", "2002"]);
    const monthly = resolveView({ ...EMPTY_VIEW, variable: "snow", resolution: "yearly", date: "2002" }, inventory)!;
    expect([monthly.resolution, monthly.date, monthly.steps[0]]).toEqual(["monthly", "2002-01", "2002-01"]);
    expect(resolveView({ ...EMPTY_VIEW, variable: "nope", resolution: "monthly", date: "2001-05" }, inventory)!.variable.name).toBe("runoff");
    // The monthly axis starts in March 2001.
    expect(resolveView({ ...EMPTY_VIEW, resolution: "monthly", date: "2001-01" }, inventory)!.date).toBe("2001-03");
    expect(resolveView({ ...EMPTY_VIEW, variable: "runoff" }, { ...inventory, variables: [] })).toBeNull();
  });

  it("moves a date between resolutions to the same year or month", () => {
    expect(convertDate("2001", ["2001-03", "2001-04", "2002-01"])).toBe("2001-03");
    expect(convertDate("2001-04-20", ["2001-03", "2001-04"])).toBe("2001-04");
    expect(convertDate("2005-01", ["2001-03", "2002-01"])).toBe("2002-01");
    expect(convertDate(null, ["2001", "2002"])).toBe("2002");
  });
});

describe("the map's request", () => {
  it("sends the style only for the parts that were set", () => {
    const r = { variable: "runoff", resolution: "yearly" as const, date: "2000" };
    expect(mapQuery(r, EMPTY_VIEW)).toBe("variable=runoff&resolution=yearly&start=2000");
    expect(mapQuery(r, { ...EMPTY_VIEW, ramp: "DarkBlue", min: 0, max: 50, log: false })).toBe(
      "variable=runoff&resolution=yearly&start=2000&ramp=DarkBlue&min=0&max=50&log=false"
    );
  });

  it("checks the style against what the MT drew with", () => {
    const legend = { min: 0, max: 10, log: false };
    expect(styleProblem({ min: null, max: null, log: null }, legend)).toBeNull();
    expect(styleProblem({ min: 5, max: 5, log: null }, legend)).toMatch(/below/);
    expect(styleProblem({ min: null, max: 20, log: null }, legend)).toBeNull();
    expect(styleProblem({ min: 20, max: null, log: null }, legend)).toMatch(/below/);
    expect(styleProblem({ min: null, max: null, log: true }, legend)).toMatch(/above 0/);
    expect(styleProblem({ min: 0.1, max: null, log: true }, legend)).toBeNull();
  });
});

describe("the series", () => {
  it("is asked for a calendar year of days, and the whole span otherwise", () => {
    const base = { variable: "runoff" };
    expect(seriesQuery({ ...base, resolution: "daily", date: "2001-05-03" }, { lon: 1.5, lat: 2 })).toBe(
      "variable=runoff&resolution=daily&point=1.5%2C2&display=true&start=2001&end=2001"
    );
    expect(seriesQuery({ ...base, resolution: "monthly", date: "2001-05" }, { lon: 1, lat: 2 })).not.toContain("start");
  });

  it("keeps the offset-th point and every step-th: offset 11 step 12 is Decembers", () => {
    const months = stepsFor("monthly", [2000, 2001, 2002]);
    expect(filterSeries(months, 11, 12)).toEqual(["2000-12", "2001-12", "2002-12"]);
    expect(filterSeries([1, 2, 3, 4], 0, 1)).toEqual([1, 2, 3, 4]);
    expect(filterSeries([1, 2, 3, 4, 5], 1, 2)).toEqual([2, 4]);
    expect(filterSeries([1, 2, 3], 5, 1)).toEqual([]);
  });

  it("writes the plotted values as CSV, empty where there is no data", () => {
    expect(seriesCsv(["2000-12", "2001-12"], [1.5, null], "runoff", "mm/month")).toBe(
      "time,runoff (mm/month)\n2000-12,1.5\n2001-12,\n"
    );
    expect(seriesCsv(["a"], [2], "x,y", null)).toBe('time,"x,y"\na,2\n');
  });

  it("chooses round ticks", () => {
    expect(niceTicks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(0.1, 0.9)).toEqual([0.2, 0.4, 0.6, 0.8]);
    expect(niceTicks(3, 3)).toEqual([3]);
  });
});

describe("the NetCDF download's periods", () => {
  it("offers the step, its year and every year, with how many steps each holds", () => {
    const monthly = downloadOptions("monthly", "2001-05", [2000, 2001, 2002]);
    expect(monthly.map((o) => [o.scope, o.steps])).toEqual([["step", 1], ["year", 12], ["all", 36]]);
    const yearly = downloadOptions("yearly", "2001", [2000, 2001, 2002]);
    expect(yearly.map((o) => [o.scope, o.steps])).toEqual([["step", 1], ["all", 3]]);
    const daily = downloadOptions("daily", "2001-02-03", [2001]);
    expect(daily.map((o) => [o.scope, o.steps])).toEqual([["step", 28], ["year", 365]]);
  });
});

describe("the words for a refusal", () => {
  it("tells purged scratch and no output apart from a failure", () => {
    expect(describeProblem(410, { detail: { code: "output_purged", message: "x" } }).kind).toBe("purged");
    expect(describeProblem(404, { detail: { code: "output_missing", message: "x" } }).kind).toBe("missing");
    expect(describeProblem(401, { code: "session_expired", message: "x" }).kind).toBe("signed-out");
  });

  it("shows the toolkit's message for a 422, capitalised", () => {
    expect(describeProblem(422, { detail: { code: "output_request_refused", message: "a daily series may span at most a year" } })).toEqual({
      kind: "limit",
      message: "A daily series may span at most a year",
    });
  });

  it("names an unreachable Anvil and falls back for the rest", () => {
    expect(describeProblem(503, { detail: { code: "anvil_unreachable", message: "x" } }).message).toMatch(/Anvil could not be reached/);
    expect(describeProblem(500, null)).toEqual({ kind: "error", message: "The output could not be read. Try again." });
  });
});
