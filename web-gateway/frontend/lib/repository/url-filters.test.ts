import { describe, expect, it } from "vitest";
import {
  catalogueFiltersToParams,
  datasetFiltersToParams,
  parseCatalogueFilters,
  parseDatasetFilters,
  toURLSearchParams,
} from "./url-filters";
import { EMPTY_CATALOGUE_FILTERS } from "./catalogue";
import type { CatalogueFilterState } from "./types";

const FULL: CatalogueFilterState = {
  searchQuery: "storage",
  type: ["snapshot", "model-input"],
  category: ["hydrology", "ancillary"],
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
  sortBy: "coverage-start",
  view: "grid",
  page: 3,
};

describe("toURLSearchParams", () => {
  it("keeps every value of a repeated key", () => {
    const params = toURLSearchParams({ category: ["a", "b"], q: "x", skipped: undefined });
    expect(params.getAll("category")).toEqual(["a", "b"]);
    expect(params.get("q")).toBe("x");
    expect(params.has("skipped")).toBe(false);
  });

  it("still gives get() the first value, as the single-value callers read it", () => {
    const params = toURLSearchParams({ page: ["2", "5"] });
    expect(params.get("page")).toBe("2");
    expect(parseDatasetFilters(params).page).toBe(2);
  });
});

describe("catalogue filters in the URL", () => {
  it("writes each selected value as its own repeated key, never a comma list", () => {
    const qs = catalogueFiltersToParams(FULL).toString();
    expect(qs).toContain("category=hydrology&category=ancillary");
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
    const sp = { type: ["snapshot", "model-input"], category: "hydrology", q: "x" };
    const parsed = parseCatalogueFilters(toURLSearchParams(sp));
    expect(parsed.type).toEqual(["snapshot", "model-input"]);
    expect(parsed.category).toEqual(["hydrology"]);
    expect(parsed.searchQuery).toBe("x");
  });

  it("drops empty and repeated values and an unknown type", () => {
    const parsed = parseCatalogueFilters(
      new URLSearchParams("category=a&category=&category=a&type=snapshot&type=bogus")
    );
    expect(parsed.category).toEqual(["a"]);
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

describe("catalogue sort and view in the URL", () => {
  it("reads and writes coverage-start and view=grid", () => {
    const parsed = parseCatalogueFilters(new URLSearchParams("sort=coverage-start&view=grid"));
    expect(parsed.sortBy).toBe("coverage-start");
    expect(parsed.view).toBe("grid");
    const qs = catalogueFiltersToParams(parsed).toString();
    expect(qs).toBe("sort=coverage-start&view=grid");
  });

  it("keeps coverage-start out of the snapshot picker, whose route does not take it", () => {
    expect(parseDatasetFilters(new URLSearchParams("sort=coverage-start")).sortBy).toBe("relevance");
  });
});

describe("dataset filters (the snapshot picker)", () => {
  it("still round-trips", () => {
    const filters = parseDatasetFilters(new URLSearchParams("q=a&year_start=2000&page=2&sort=title-az"));
    expect(datasetFiltersToParams(filters).toString()).toBe(
      "q=a&year_start=2000&sort=title-az&page=2"
    );
  });
});
