import { describe, expect, it } from "vitest";
import {
  catalogueFiltersToParams,
  parseCatalogueFilters,
  parsePickerFilters,
  pickerFiltersToParams,
  toURLSearchParams,
} from "./url-filters";
import { CATALOGUE_FILTER_GROUPS, EMPTY_CATALOGUE_FILTERS, type CatalogueFilterGroup } from "./catalogue";
import type { CatalogueFilterState } from "./types";

const FULL: CatalogueFilterState = {
  searchQuery: "storage",
  type: ["snapshot", "model-input"],
  tag: ["publication", "ancillary-data"],
  keyword: ["water balance", "Hydrology"],
  output: ["discharge", "runoff", "soilMoisture"],
  forcing: ["windU"],
  wbm: ["1.0.0"],
  process: ["irrigation"],
  creator: ["Ada Hydro"],
  license: ["GPL-3.0-only", "CC-BY-4.0"],
  yearStart: 2000,
  yearEnd: 2009,
  spatialResMin: 0.0833,
  spatialResMax: 0.25,
  boxNorth: 45,
  boxSouth: 40,
  boxEast: -100,
  boxWest: -110.5,
  sortBy: "coverage-start",
  view: "grid",
  page: 3,
};

describe("toURLSearchParams", () => {
  it("keeps every value of a repeated key", () => {
    const params = toURLSearchParams({ tag: ["a", "b"], q: "x", skipped: undefined });
    expect(params.getAll("tag")).toEqual(["a", "b"]);
    expect(params.get("q")).toBe("x");
    expect(params.has("skipped")).toBe(false);
  });

  it("still gives get() the first value, as the single-value callers read it", () => {
    const params = toURLSearchParams({ page: ["2", "5"] });
    expect(params.get("page")).toBe("2");
    expect(parsePickerFilters(params).page).toBe(2);
  });
});

describe("catalogue filters in the URL", () => {
  it("writes each selected value as its own repeated key, never a comma list", () => {
    const qs = catalogueFiltersToParams(FULL).toString();
    expect(qs).toContain("tag=publication&tag=ancillary-data");
    expect(qs).toContain("keyword=water+balance&keyword=Hydrology");
    expect(qs).toContain("output=discharge&output=runoff&output=soilMoisture");
    expect(qs).not.toContain(",");
    expect(qs).not.toContain("%2C");
  });

  it("round-trips every field through a query string", () => {
    const qs = catalogueFiltersToParams(FULL).toString();
    expect(parseCatalogueFilters(new URLSearchParams(qs))).toEqual(FULL);
  });

  it("round-trips the empty state to an empty query string", () => {
    expect(catalogueFiltersToParams(EMPTY_CATALOGUE_FILTERS).toString()).toBe("");
    expect(parseCatalogueFilters(new URLSearchParams(""))).toEqual(EMPTY_CATALOGUE_FILTERS);
  });

  it("round-trips through the Next searchParams shape too", () => {
    const sp = { type: ["snapshot", "model-input"], tag: "publication", q: "x" };
    const parsed = parseCatalogueFilters(toURLSearchParams(sp));
    expect(parsed.type).toEqual(["snapshot", "model-input"]);
    expect(parsed.tag).toEqual(["publication"]);
    expect(parsed.searchQuery).toBe("x");
  });

  it("drops empty and repeated values and an unknown type", () => {
    const parsed = parseCatalogueFilters(
      new URLSearchParams("tag=a&tag=&tag=a&type=snapshot&type=bogus")
    );
    expect(parsed.tag).toEqual(["a"]);
    expect(parsed.type).toEqual(["snapshot"]);
  });

  it("omits the default sort, the list view and page 1, and falls back on a bad sort, view or page", () => {
    expect(
      catalogueFiltersToParams({ ...FULL, sortBy: "relevance", view: "list", page: 1 }).toString()
    ).not.toMatch(/sort=|view=|page=/);
    const parsed = parseCatalogueFilters(
      new URLSearchParams("sort=bogus&view=carousel&page=-4&year_start=abc")
    );
    expect(parsed.sortBy).toBe("relevance");
    expect(parsed.view).toBe("list");
    expect(parsed.page).toBe(1);
    expect(parsed.yearStart).toBeNull();
  });
});

describe("the region box in the URL", () => {
  it("writes and reads the four edges under the API's own parameter names", () => {
    const qs = catalogueFiltersToParams(FULL);
    expect(qs.get("north")).toBe("45");
    expect(qs.get("south")).toBe("40");
    expect(qs.get("east")).toBe("-100");
    expect(qs.get("west")).toBe("-110.5");
    const parsed = parseCatalogueFilters(new URLSearchParams("north=10&south=-10&east=-170&west=170"));
    // west above east is a box across the antimeridian, not an error
    expect([parsed.boxNorth, parsed.boxSouth, parsed.boxEast, parsed.boxWest]).toEqual([10, -10, -170, 170]);
  });

  it("writes nothing for a box that is not whole and valid", () => {
    const partial = { ...FULL, boxWest: null };
    expect(catalogueFiltersToParams(partial).toString()).not.toMatch(/north|south|east|west/);
    const inverted = { ...FULL, boxNorth: 10, boxSouth: 20 };
    expect(catalogueFiltersToParams(inverted).toString()).not.toMatch(/north|south|east|west/);
  });

  it.each([
    ["a partial box", "north=10&south=0&east=5"],
    ["an out-of-range edge", "north=95&south=0&east=5&west=0"],
    ["a south above the north", "north=0&south=10&east=5&west=0"],
    ["a non-numeric edge", "north=a&south=0&east=5&west=0"],
  ])("drops %s from a pasted link, as the API would answer 422 for it", (_name, qs) => {
    const parsed = parseCatalogueFilters(new URLSearchParams(qs));
    expect([parsed.boxNorth, parsed.boxSouth, parsed.boxEast, parsed.boxWest]).toEqual([null, null, null, null]);
  });

  it("is kept by the picker, whose More filters dialog has the Region group", () => {
    const qs = "north=45&south=40&east=-100&west=-110";
    const filters = parsePickerFilters(new URLSearchParams(qs));
    expect(filters.boxWest).toBe(-110);
    expect(pickerFiltersToParams(filters).toString()).toBe(qs);
  });
});

describe("catalogue sort and view in the URL", () => {
  it("reads and writes coverage-start and view=grid", () => {
    const parsed = parseCatalogueFilters(new URLSearchParams("sort=coverage-start&view=grid"));
    expect(parsed.sortBy).toBe("coverage-start");
    expect(parsed.view).toBe("grid");
    const qs = catalogueFiltersToParams(parsed).toString();
    expect(qs).toBe("sort=coverage-start&view=grid");
  });
});

describe("the snapshot picker's filters (every group of the definition but the fixed type)", () => {
  it("round-trips the search, the tags, the year and resolution ranges and the page", () => {
    const qs = "q=wbm&tag=publication&tag=tutorial&year_start=2000&year_end=2009&spatial_res_min=0.08&spatial_res_max=0.25&page=2";
    const filters = parsePickerFilters(new URLSearchParams(qs));
    expect(filters.tag).toEqual(["publication", "tutorial"]);
    expect(filters.type).toEqual([]);
    expect(pickerFiltersToParams(filters).toString()).toBe(qs);
  });

  it("keeps the filters only the More filters dialog has, and round-trips them", () => {
    const qs = "q=a&keyword=hydrology&output=discharge&output=runoff&forcing=windU&wbm=1.0.0&process=irrigation&creator=Ada+Hydro&license=CC-BY-4.0";
    const filters = parsePickerFilters(new URLSearchParams(qs));
    expect(filters.keyword).toEqual(["hydrology"]);
    expect(filters.output).toEqual(["discharge", "runoff"]);
    expect(filters.forcing).toEqual(["windU"]);
    expect(filters.wbm).toEqual(["1.0.0"]);
    expect(filters.process).toEqual(["irrigation"]);
    expect(filters.creator).toEqual(["Ada Hydro"]);
    expect(filters.license).toEqual(["CC-BY-4.0"]);
    expect(pickerFiltersToParams(filters).toString()).toBe(qs);
  });

  it("drops what the picker fixes or has no control for: the type, the sort and the view", () => {
    const filters = parsePickerFilters(new URLSearchParams("type=model-input&sort=title-az&view=grid&q=a"));
    expect(filters).toEqual({ ...EMPTY_CATALOGUE_FILTERS, searchQuery: "a" });
    expect(pickerFiltersToParams(filters).toString()).toBe("q=a");
  });

  it("reads the keys from the definition: a group taken out of it is no longer read", () => {
    const groups = CATALOGUE_FILTER_GROUPS as CatalogueFilterGroup[];
    const keyword = groups.find((g) => g.key === "keyword") as CatalogueFilterGroup;
    const at = groups.indexOf(keyword);
    groups.splice(at, 1);
    try {
      // Out of the definition, the picker no longer reads it.
      expect(parsePickerFilters(new URLSearchParams("keyword=hydrology")).keyword).toEqual([]);
    } finally {
      groups.splice(at, 0, keyword);
    }
    expect(parsePickerFilters(new URLSearchParams("keyword=hydrology")).keyword).toEqual(["hydrology"]);
  });
});
