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
  chipNames,
  contentsLabel,
  creatorLabel,
  detailHref,
  periodLabel,
  resolutionLabels,
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

  it("names a preset resolution by its preset", () => {
    expect(formatResolutionRange(5 / 60, 5 / 60)).toBe("5 arc-min");
    expect(formatResolutionRange(0.1, 0.3)).toBe("0.1° – 0.3°");
  });

  it("clears everything but the sort", () => {
    expect(clearedFilters(filters({ sortBy: "newest", output: ["a"], page: 4 }))).toEqual(
      filters({ sortBy: "newest" })
    );
  });
});

describe("card text", () => {
  it("describes a snapshot", () => {
    const s = snapshotItem();
    expect(detailHref(s)).toBe("/repository/snap-1");
    expect(periodLabel(s)).toBe("2000 – 2009");
    expect(resolutionLabels(s)).toEqual(["5 arc-minute"]);
    expect(contentsLabel(s)).toBe("WBM 1.0.0");
    expect(creatorLabel(s)).toEqual({ first: "Ada Hydro", more: 1 });
    expect(chipNames(s)).toEqual({ shown: ["discharge", "runoff", "soilMoisture"], more: 2 });
  });

  it("describes a model input", () => {
    const m = modelInputItem();
    expect(detailHref(m)).toBe("/repository/model-inputs/mi-1");
    expect(periodLabel(m)).toBeNull();
    expect(resolutionLabels(m)).toEqual(["5 arc-minute", "30 arc-second"]);
    expect(contentsLabel(m)).toBe("3 datasets · 3 networks");
    expect(chipNames(m).more).toBe(2);
  });

  it("gives a model input with no network resolution none", () => {
    const m = modelInputItem({ networks: undefined });
    expect(resolutionLabels(m)).toEqual([]);
    expect(contentsLabel(m)).toBe("3 datasets");
  });
});
