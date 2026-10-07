import { describe, expect, it } from "vitest";
import {
  activeFilterChips,
  clearedFilters,
  countActiveFilters,
  countMoreFilters,
  formatResolutionRange,
  hasActiveFilters,
  humanizeForcing,
  humanizeTag,
  formatTags,
  facetOptionLabel,
  ABOUT_TAGS,
  CATALOGUE_FACET_KEYS,
  CATALOGUE_FACET_NAMES,
  CATALOGUE_FILTER_GROUPS,
  SNAPSHOT_PICKER_FIXED_FILTERS,
  groupFilterKeys,
  pickerFilterGroups,
  pickerFilterKeys,
  visibleFilterGroups,
} from "./catalogue";
import { FACETS, filters } from "@/components/repository/catalogue.fixtures";
import {
  cardKeywords,
  contentsLabel,
  contentsLine,
  coverageLine,
  creatorLabel,
  detailHref,
  periodLabel,
  resolutionLabels,
  resolutionSummary,
  resolutionText,
} from "./catalogue-format";
import { modelInputItem, snapshotItem } from "@/components/repository/catalogue.fixtures";

describe("humanizeForcing", () => {
  it("names the spec roles", () => {
    expect(humanizeForcing("windU")).toBe("Wind (u)");
    expect(humanizeForcing("windV")).toBe("Wind (v)");
    expect(humanizeForcing("airTemperature")).toBe("Air temperature");
    expect(humanizeForcing("precipitationFraction")).toBe("Precipitation fraction");
    expect(humanizeForcing("leafAreaIndex")).toBe("Leaf area index");
  });

  it("spaces out a role it does not know", () => {
    expect(humanizeForcing("soilHeatFlux")).toBe("Soil heat flux");
  });
});

describe("humanizeTag", () => {
  it("names every tag in the spec's closed list", () => {
    expect(ABOUT_TAGS.map(humanizeTag)).toEqual([
      "Publication",
      "Tutorial",
      "Test",
      "Ancillary data",
      "Climate forcing",
      "River network",
    ]);
  });

  it("capitalises a tag it does not know and spaces its hyphens", () => {
    expect(humanizeTag("sea-ice-extent")).toBe("Sea ice extent");
    expect(humanizeTag("lakes")).toBe("Lakes");
  });

  it("joins a list for plain text, and a tag facet option shows the readable name", () => {
    expect(formatTags(["publication", "river-network"])).toBe("Publication, River network");
    expect(facetOptionLabel("tag", "ancillary-data", "ancillary-data")).toBe("Ancillary data");
  });
});

describe("active filters", () => {
  it("counts values, years and resolution once each, and the search apart", () => {
    const f = filters({ output: ["a", "b"], yearStart: 2000, spatialResMax: 0.5, searchQuery: "x" });
    expect(countActiveFilters(f)).toBe(4);
    expect(hasActiveFilters(filters({ searchQuery: "x" }))).toBe(true);
    expect(countActiveFilters(filters({ searchQuery: "x" }))).toBe(0);
    expect(hasActiveFilters(filters())).toBe(false);
  });

  it("builds one chip per value with the facet's own label, and a way to remove it", () => {
    const chips = activeFilterChips(
      filters({ output: ["discharge", "runoff"], forcing: ["windU"], yearStart: 2000, yearEnd: 2009 }),
      FACETS
    );
    expect(chips.map((c) => c.label)).toEqual([
      "Output: Discharge",
      "Output: Runoff",
      "Forcing: Wind (u)",
      "Years: 2000 – 2009",
    ]);
    expect(chips[0].remove).toEqual({ output: ["runoff"] });
    expect(chips[3].remove).toEqual({ yearStart: null, yearEnd: null });
  });

  it("labels a keyword chip \"Keyword: X\" and takes just that one off", () => {
    const chips = activeFilterChips(filters({ keyword: ["water balance", "soils"] }), FACETS);
    expect(chips.map((c) => c.label)).toEqual(["Keyword: water balance", "Keyword: soils"]);
    expect(chips[0].remove).toEqual({ keyword: ["soils"] });
  });

  it("labels a tag chip \"Tag: Name\" with the readable name and takes just that one off", () => {
    const chips = activeFilterChips(filters({ tag: ["ancillary-data", "test"] }), FACETS);
    expect(chips.map((c) => c.label)).toEqual(["Tag: Ancillary data", "Tag: Test"]);
    expect(chips[0].remove).toEqual({ tag: ["test"] });
    expect(countActiveFilters(filters({ tag: ["a", "b"] }))).toBe(2);
  });

  it("names a preset resolution by its preset", () => {
    expect(formatResolutionRange(5 / 60, 5 / 60)).toBe("5 arc-min");
    expect(formatResolutionRange(0.1, 0.3)).toBe("0.1° – 0.3°");
  });

  it("clears everything but the sort and the view", () => {
    expect(
      clearedFilters(filters({ sortBy: "coverage-start", view: "grid", output: ["a"], page: 4 }))
    ).toEqual(filters({ sortBy: "coverage-start", view: "grid" }));
  });
});

describe("the filter groups", () => {
  it("name every facet once, with its title from the facet names, and add the two ranges", () => {
    const facetKeys = CATALOGUE_FILTER_GROUPS.filter((g) => g.kind === "facet").map((g) => g.key);
    expect([...facetKeys].sort()).toEqual([...CATALOGUE_FACET_KEYS].sort());
    for (const g of CATALOGUE_FILTER_GROUPS) {
      if (g.kind === "facet") expect(g.title).toBe(CATALOGUE_FACET_NAMES[g.key].title);
    }
    expect(CATALOGUE_FILTER_GROUPS.filter((g) => g.kind !== "facet").map((g) => g.title)).toEqual([
      "Temporal coverage",
      "Spatial resolution",
    ]);
  });

  it("read every filter-state key between them, the search, sort, view and page aside", () => {
    const keys = CATALOGUE_FILTER_GROUPS.flatMap(groupFilterKeys).sort();
    expect(keys).toEqual(
      Object.keys(filters())
        .filter((k) => !["searchQuery", "sortBy", "view", "page"].includes(k))
        .sort()
    );
  });

  it("hide a facet group with no options and nothing selected, but not Type", () => {
    const titles = (f = filters()) => visibleFilterGroups(FACETS, f).map((g) => g.title);
    expect(titles()).not.toContain("Active processes");
    expect(titles(filters({ process: ["irrigation"] }))).toContain("Active processes");
    const bare = visibleFilterGroups({ ...FACETS, type: [], keyword: [] }, filters());
    expect(bare.map((g) => g.title)).toContain("Type");
    expect(bare.map((g) => g.title)).not.toContain("Keyword");
  });

  it("leave out what the context fixes: the picker's type, and nothing else", () => {
    const all = visibleFilterGroups(FACETS, filters()).map((g) => g.key);
    const fixed = visibleFilterGroups(FACETS, filters(), SNAPSHOT_PICKER_FIXED_FILTERS).map((g) => g.key);
    expect(all).toContain("type");
    expect(fixed).toEqual(all.filter((k) => k !== "type"));
  });

  it("flag Tags, Temporal coverage and Spatial resolution for the picker, and no other", () => {
    expect(CATALOGUE_FILTER_GROUPS.filter((g) => g.picker).map((g) => g.title)).toEqual([
      "Tags",
      "Temporal coverage",
      "Spatial resolution",
    ]);
    expect(pickerFilterGroups(FACETS, filters()).map((g) => g.title)).toEqual([
      "Tags",
      "Temporal coverage",
      "Spatial resolution",
    ]);
  });

  it("read and write in the picker the keys of every group but the fixed type, flagged or not", () => {
    expect(pickerFilterKeys().sort()).toEqual(
      [
        "creator",
        "forcing",
        "keyword",
        "license",
        "output",
        "process",
        "spatialResMax",
        "spatialResMin",
        "tag",
        "wbm",
        "yearEnd",
        "yearStart",
      ].sort()
    );
  });

  it("count, for the More filters button, only filters in groups the compact panel lacks", () => {
    expect(countMoreFilters(filters())).toBe(0);
    // Tags, years and resolution are in the panel; the type is fixed.
    expect(countMoreFilters(filters({ tag: ["publication"], yearStart: 2000, type: ["snapshot"] }))).toBe(0);
    expect(countMoreFilters(filters({ keyword: ["a", "b"], output: ["discharge"], tag: ["publication"] }))).toBe(3);
  });
});

describe("a fixed filter is not the user's", () => {
  const fixedState = filters({ type: ["snapshot"], tag: ["publication"] });

  it("is not counted, not a chip, and does not make a list filtered", () => {
    expect(countActiveFilters(fixedState)).toBe(2);
    expect(countActiveFilters(fixedState, SNAPSHOT_PICKER_FIXED_FILTERS)).toBe(1);
    expect(activeFilterChips(fixedState, FACETS, SNAPSHOT_PICKER_FIXED_FILTERS).map((c) => c.id)).toEqual([
      "tag:publication",
    ]);
    expect(hasActiveFilters(filters({ type: ["snapshot"] }), SNAPSHOT_PICKER_FIXED_FILTERS)).toBe(false);
    expect(hasActiveFilters(filters({ type: ["snapshot"] }))).toBe(true);
  });
});

describe("card text", () => {
  it("describes a snapshot", () => {
    const s = snapshotItem();
    expect(detailHref(s)).toBe("/repository/snap-1");
    expect(periodLabel(s)).toBe("2000–2009");
    expect(resolutionLabels(s)).toEqual(["5 arc-min"]);
    expect(resolutionSummary(s)).toBe("5 arc-min");
    expect(contentsLabel(s)).toBe("WBM 22.1.1");
    expect(contentsLine(s)).toBe("WBM 22.1.1 · GPL-3.0-only");
    expect(coverageLine(s)).toBe("2000–2009 · 5 arc-min");
    expect(creatorLabel(s)).toEqual({ first: "Ada Hydro", more: 1 });
    expect(cardKeywords(s)).toEqual({
      shown: ["storage", "water balance", "global", "monthly"],
      more: 2,
      hidden: ["reservoirs", "streamflow"],
    });
  });

  it("describes a model input", () => {
    const m = modelInputItem();
    expect(detailHref(m)).toBe("/repository/model-inputs/mi-1");
    expect(periodLabel(m)).toBeNull();
    expect(resolutionLabels(m)).toEqual(["5 arc-min", "30 arc-sec"]);
    expect(resolutionSummary(m)).toBe("5 arc-min, 30 arc-sec");
    expect(contentsLabel(m)).toBe("3 datasets · 3 networks");
    expect(contentsLine(m)).toBe("3 datasets · 3 networks · CC-BY-4.0");
    expect(coverageLine(m)).toBe("Climatological · 5 arc-min, 30 arc-sec");
    expect(cardKeywords(m)).toMatchObject({ more: 1, hidden: ["lakes"] });
    expect(cardKeywords(m, 5)).toMatchObject({ more: 0, hidden: [] });
  });

  it("gives a model input with no network resolution none", () => {
    const m = modelInputItem({ networks: undefined });
    expect(resolutionLabels(m)).toEqual([]);
    expect(resolutionSummary(m)).toBe("—");
    expect(coverageLine(m)).toBe("Climatological");
    expect(contentsLabel(m)).toBe("3 datasets");
  });

  it("abbreviates the resolution units as the filter chips do", () => {
    expect(resolutionText({ value: 30, unit: "arc-second" })).toBe("30 arc-sec");
    expect(resolutionText({ value: 15, unit: "arc-minute" })).toBe("15 arc-min");
    expect(resolutionText({ value: 0.5, unit: "degree" })).toBe("0.5°");
  });

  it("writes a one-year period as that year", () => {
    const s = snapshotItem();
    const one = {
      ...s,
      simulation: { ...s.simulation, temporalCoverage: { start: "2001-01-01", end: "2001-12-31" } },
    };
    expect(periodLabel(one)).toBe("2001");
  });
});
