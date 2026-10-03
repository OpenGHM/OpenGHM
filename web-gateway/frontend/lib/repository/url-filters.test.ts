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

describe("catalogue sort and view in the URL", () => {
  it("reads and writes coverage-start and view=grid", () => {
    const parsed = parseCatalogueFilters(new URLSearchParams("sort=coverage-start&view=grid"));
    expect(parsed.sortBy).toBe("coverage-start");
    expect(parsed.view).toBe("grid");
    const qs = catalogueFiltersToParams(parsed).toString();
    expect(qs).toBe("sort=coverage-start&view=grid");
  });
});

describe("the snapshot picker's filters (the catalogue's, of the groups it offers)", () => {
  it("round-trips the search, the tags, the year and resolution ranges and the page", () => {
    const qs = "q=wbm&tag=publication&tag=tutorial&year_start=2000&year_end=2009&spatial_res_min=0.08&spatial_res_max=0.25&page=2";
    const filters = parsePickerFilters(new URLSearchParams(qs));
    expect(filters.tag).toEqual(["publication", "tutorial"]);
    expect(filters.type).toEqual([]);
    expect(pickerFiltersToParams(filters).toString()).toBe(qs);
  });

  it("drops what no group of the picker covers: other facets, the type, the sort and the view", () => {
    const filters = parsePickerFilters(
      new URLSearchParams("type=model-input&keyword=hydrology&output=discharge&sort=title-az&view=grid&q=a")
    );
    expect(filters).toEqual({ ...EMPTY_CATALOGUE_FILTERS, searchQuery: "a" });
    expect(pickerFiltersToParams(filters).toString()).toBe("q=a");
  });

  it("keeps the keys of the groups flagged for the picker, whichever they are", () => {
    const groups = CATALOGUE_FILTER_GROUPS as CatalogueFilterGroup[];
    const keyword = groups.find((g) => g.key === "keyword") as CatalogueFilterGroup;
    const was = keyword.picker;
    keyword.picker = true;
    try {
      expect(parsePickerFilters(new URLSearchParams("keyword=hydrology")).keyword).toEqual(["hydrology"]);
    } finally {
      keyword.picker = was;
    }
    expect(parsePickerFilters(new URLSearchParams("keyword=hydrology")).keyword).toEqual([]);
  });
});
