/**
 * The catalogue list's shared constants and pure helpers: the empty states, the
 * facet groups' names, and the active-filter summary the sidebar badge and the
 * chip row both read. No React and no I/O, so tests call it directly.
 */
import { SPATIAL_RES_PRESETS } from "./data";
import type {
  CatalogueFacetKey,
  CatalogueFacets,
  CatalogueFilterState,
  CatalogueResponse,
} from "./types";

/** Every facet key, in the order the sidebar lists the groups that use one. */
export const CATALOGUE_FACET_KEYS: readonly CatalogueFacetKey[] = [
  "type",
  "category",
  "output",
  "forcing",
  "wbm",
  "process",
  "creator",
  "license",
];

/** Page size the list asks the backend for. */
export const CATALOGUE_PAGE_SIZE = 10;

/**
 * Group headings, and the shorter name a chip prefixes its value with
 * ("Output: Discharge").
 */
export const CATALOGUE_FACET_NAMES: Record<CatalogueFacetKey, { title: string; chip: string }> = {
  type: { title: "Type", chip: "Type" },
  category: { title: "Category", chip: "Category" },
  output: { title: "Output variable", chip: "Output" },
  forcing: { title: "Forcing data", chip: "Forcing" },
  wbm: { title: "Model version", chip: "Model version" },
  process: { title: "Active processes", chip: "Process" },
  creator: { title: "Creator", chip: "Creator" },
  license: { title: "License", chip: "License" },
};

export const EMPTY_CATALOGUE_FILTERS: CatalogueFilterState = {
  searchQuery: "",
  type: [],
  category: [],
  output: [],
  forcing: [],
  wbm: [],
  process: [],
  creator: [],
  license: [],
  yearStart: null,
  yearEnd: null,
  spatialResMin: null,
  spatialResMax: null,
  sortBy: "relevance",
  page: 1,
};

export const EMPTY_CATALOGUE_FACETS: CatalogueFacets = {
  type: [],
  category: [],
  output: [],
  forcing: [],
  wbm: [],
  process: [],
  creator: [],
  license: [],
  yearBounds: null,
};

export const EMPTY_CATALOGUE: CatalogueResponse = {
  items: [],
  totalCount: 0,
  totalPages: 1,
  page: 1,
  facets: EMPTY_CATALOGUE_FACETS,
};

/** What "Clear all" sets: every filter and the search off, the sort kept, page 1. */
export function clearedFilters(filters: CatalogueFilterState): CatalogueFilterState {
  return { ...EMPTY_CATALOGUE_FILTERS, sortBy: filters.sortBy };
}

/** Filters in effect, not counting the search box: what the Filters badge shows. */
export function countActiveFilters(filters: CatalogueFilterState): number {
  let n = 0;
  for (const key of CATALOGUE_FACET_KEYS) n += filters[key].length;
  if (filters.yearStart !== null || filters.yearEnd !== null) n += 1;
  if (filters.spatialResMin !== null || filters.spatialResMax !== null) n += 1;
  return n;
}

/** Anything at all narrowing the list, the search included. */
export function hasActiveFilters(filters: CatalogueFilterState): boolean {
  return countActiveFilters(filters) > 0 || filters.searchQuery.trim() !== "";
}

// ─── Labels ──────────────────────────────────────────────────────────────────

const FORCING_LABELS: Record<string, string> = {
  precipitation: "Precipitation",
  precipitationFraction: "Precipitation fraction",
  airTemperature: "Air temperature",
  windU: "Wind (u)",
  windV: "Wind (v)",
  cloudFraction: "Cloud fraction",
  humidity: "Humidity",
  albedo: "Albedo",
  leafAreaIndex: "Leaf area index",
};

/** A forcing role as people read it: "windU" is "Wind (u)", an unknown role is
 *  its camelCase spaced out. */
export function humanizeForcing(role: string): string {
  const known = FORCING_LABELS[role];
  if (known) return known;
  const spaced = role.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  if (!spaced) return role;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** The text of one option: forcing roles are humanised here, the rest come labelled. */
export function facetOptionLabel(key: CatalogueFacetKey, value: string, label?: string): string {
  if (key === "forcing") return humanizeForcing(value);
  return label ?? value;
}

/** A resolution in degrees: a preset's own name when it is one, otherwise degrees. */
export function formatDegrees(degrees: number): string {
  const preset = SPATIAL_RES_PRESETS.find((p) => Math.abs(p.degrees - degrees) < 1e-9);
  if (preset) return preset.label;
  return `${Number(degrees.toFixed(4))}°`;
}

export function formatResolutionRange(min: number | null, max: number | null): string {
  if (min !== null && max !== null) {
    return min === max ? formatDegrees(min) : `${formatDegrees(min)} – ${formatDegrees(max)}`;
  }
  if (min !== null) return `${formatDegrees(min)} or coarser`;
  if (max !== null) return `${formatDegrees(max)} or finer`;
  return "";
}

export function formatYearRange(start: number | null, end: number | null): string {
  if (start !== null && end !== null) return start === end ? String(start) : `${start} – ${end}`;
  if (start !== null) return `${start} or later`;
  if (end !== null) return `${end} or earlier`;
  return "";
}

// ─── Active-filter chips ─────────────────────────────────────────────────────

export interface ActiveFilterChip {
  /** Stable key, e.g. `output:discharge`. */
  id: string;
  /** Visible text, e.g. "Output: Discharge". */
  label: string;
  /** What to pass to `onChange` to take this one filter off. */
  remove: Partial<CatalogueFilterState>;
}

/** One chip per selected value, plus one each for the search, the years and the resolution. */
export function activeFilterChips(
  filters: CatalogueFilterState,
  facets: CatalogueFacets
): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];

  const q = filters.searchQuery.trim();
  if (q) chips.push({ id: "q", label: `Search: ‘${q}’`, remove: { searchQuery: "" } });

  for (const key of CATALOGUE_FACET_KEYS) {
    for (const value of filters[key]) {
      const option = facets[key].find((o) => o.value === value);
      chips.push({
        id: `${key}:${value}`,
        label: `${CATALOGUE_FACET_NAMES[key].chip}: ${facetOptionLabel(key, value, option?.label)}`,
        remove: { [key]: filters[key].filter((v) => v !== value) },
      });
    }
  }

  if (filters.yearStart !== null || filters.yearEnd !== null) {
    chips.push({
      id: "years",
      label: `Years: ${formatYearRange(filters.yearStart, filters.yearEnd)}`,
      remove: { yearStart: null, yearEnd: null },
    });
  }
  if (filters.spatialResMin !== null || filters.spatialResMax !== null) {
    chips.push({
      id: "resolution",
      label: `Resolution: ${formatResolutionRange(filters.spatialResMin, filters.spatialResMax)}`,
      remove: { spatialResMin: null, spatialResMax: null },
    });
  }
  return chips;
}
