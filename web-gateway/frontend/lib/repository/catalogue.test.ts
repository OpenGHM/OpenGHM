import { describe, expect, it } from "vitest";
import {
  activeFilterChips,
  clearedFilters,
  countActiveFilters,
  formatResolutionRange,
  hasActiveFilters,
  humanizeForcing,
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

describe("card text", () => {
  it("describes a snapshot", () => {
    const s = snapshotItem();
    expect(detailHref(s)).toBe("/repository/snap-1");
    expect(periodLabel(s)).toBe("2000–2009");
    expect(resolutionLabels(s)).toEqual(["5 arc-min"]);
    expect(resolutionSummary(s)).toBe("5 arc-min");
    expect(contentsLabel(s)).toBe("WBM 1.0.0");
    expect(contentsLine(s)).toBe("WBM 1.0.0 · GPL-3.0-only");
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
