/**
 * The catalogue list's shared constants and pure helpers: the empty states, the
 * filter groups (which exist, in what order, under what title), and the
 * active-filter summary the sidebar badge and the chip row both read. No React
 * and no I/O, so tests call it directly.
 */
import { SPATIAL_RES_PRESETS } from "./data";
import type { OpenGHMCitationBlock } from "./generated";
import { formatRegion, regionFromNumbers, type Region } from "./region";
import type {
  CatalogueFacetKey,
  CatalogueFacetOption,
  CatalogueFacets,
  CatalogueFilterState,
  CatalogueResponse,
} from "./types";

/** Every facet key, in the order the sidebar lists the groups that use one. */
export const CATALOGUE_FACET_KEYS: readonly CatalogueFacetKey[] = [
  "type",
  "tag",
  "keyword",
  "output",
  "forcing",
  "wbm",
  "process",
  "creator",
  "license",
];

/** Page size the list asks the backend for. */
export const CATALOGUE_PAGE_SIZE = 10;

/** Page size of the Start screen's snapshot picker: a whole number of rows of
 *  its grid at one, two, three and four columns. */
export const SNAPSHOT_PICKER_PAGE_SIZE = 12;

/**
 * Group headings, and the shorter name a chip prefixes its value with
 * ("Output: Discharge").
 */
export const CATALOGUE_FACET_NAMES: Record<CatalogueFacetKey, { title: string; chip: string }> = {
  type: { title: "Type", chip: "Type" },
  tag: { title: "Tags", chip: "Tag" },
  keyword: { title: "Keyword", chip: "Keyword" },
  output: { title: "Output variable", chip: "Output" },
  forcing: { title: "Forcing data", chip: "Forcing" },
  wbm: { title: "Model version", chip: "Model version" },
  process: { title: "Active processes", chip: "Process" },
  creator: { title: "Creator", chip: "Creator" },
  license: { title: "License", chip: "License" },
};

// ─── The filter groups ───────────────────────────────────────────────────────

/**
 * One group of filters. This list is the only place that says which filters the
 * catalogue offers, in what order and under what title: the Data Repository's
 * sidebar and the Start screen's snapshot picker both render it
 * (`components/repository/catalogue-filter-body.tsx`) and decide only the
 * presentation. A filter added here shows up in both: in the picker's dialog of
 * every filter at once, and in its compact panel when it is flagged `picker`.
 */
export type CatalogueFilterGroup =
  | {
      kind: "facet";
      /** The facet it filters on, and the key of the group. */
      key: CatalogueFacetKey;
      title: string;
      /** Also in the Start screen's snapshot picker's compact panel. The picker's "More filters" dialog lists every group, flagged or not. */
      picker: boolean;
      /** The sidebar opens the group by default; `"when-short"` only when its options fit `shortAtMost`. */
      defaultOpen: boolean | "when-short";
      shortAtMost?: number;
    }
  | { kind: "temporal"; key: "temporal"; title: string; picker: boolean; defaultOpen: boolean }
  | { kind: "resolution"; key: "resolution"; title: string; picker: boolean; defaultOpen: boolean }
  | { kind: "region"; key: "region"; title: string; picker: boolean; defaultOpen: boolean };

/** A group in `CATALOGUE_FILTER_GROUPS`, titled from `CATALOGUE_FACET_NAMES`. */
function facetGroup(
  key: CatalogueFacetKey,
  picker: boolean,
  defaultOpen: boolean | "when-short",
  shortAtMost?: number
): CatalogueFilterGroup {
  return { kind: "facet", key, title: CATALOGUE_FACET_NAMES[key].title, picker, defaultOpen, shortAtMost };
}

/** The order of the groups, top to bottom. */
export const CATALOGUE_FILTER_GROUPS: readonly CatalogueFilterGroup[] = [
  facetGroup("type", false, true),
  // The closed tag list is short: open unless it has grown past eight options.
  facetGroup("tag", true, "when-short", 8),
  // Open only when the whole list fits without "Show all".
  facetGroup("keyword", false, "when-short"),
  { kind: "temporal", key: "temporal", title: "Temporal coverage", picker: true, defaultOpen: true },
  { kind: "resolution", key: "resolution", title: "Spatial resolution", picker: true, defaultOpen: true },
  { kind: "region", key: "region", title: "Region", picker: false, defaultOpen: false },
  facetGroup("output", false, false),
  facetGroup("forcing", false, false),
  facetGroup("wbm", false, false),
  facetGroup("process", false, false),
  facetGroup("creator", false, false),
  facetGroup("license", false, false),
];

/** The filter-state keys one group reads and writes. */
export function groupFilterKeys(group: CatalogueFilterGroup): (keyof CatalogueFilterState)[] {
  if (group.kind === "temporal") return ["yearStart", "yearEnd"];
  if (group.kind === "resolution") return ["spatialResMin", "spatialResMax"];
  if (group.kind === "region") return ["boxNorth", "boxSouth", "boxEast", "boxWest"];
  return [group.key];
}

/** What the Type group offers when the facets could not be loaded. */
const TYPE_FALLBACK: CatalogueFacetOption[] = [
  { value: "snapshot", label: "Model Snapshot", count: NaN },
  { value: "model-input", label: "Model Input", count: NaN },
];

/** The options a facet group lists: the facets' own, or the fixed kinds for Type when there are none. */
export function facetGroupOptions(
  key: CatalogueFacetKey,
  facets: CatalogueFacets
): CatalogueFacetOption[] {
  return facets[key].length === 0 && key === "type" ? TYPE_FALLBACK : facets[key];
}

/** The region filter's box, or `null` when it is off (all four edges set means on). */
export function filterRegion(filters: CatalogueFilterState): Region | null {
  return regionFromNumbers(filters.boxNorth, filters.boxSouth, filters.boxEast, filters.boxWest);
}

/** How many filters one group has on: one per selected value, one for a range. */
export function groupActiveCount(group: CatalogueFilterGroup, filters: CatalogueFilterState): number {
  if (group.kind === "temporal") return filters.yearStart !== null || filters.yearEnd !== null ? 1 : 0;
  if (group.kind === "resolution") {
    return filters.spatialResMin !== null || filters.spatialResMax !== null ? 1 : 0;
  }
  if (group.kind === "region") return filterRegion(filters) ? 1 : 0;
  return filters[group.key].length;
}

/**
 * The groups a filter panel shows. `fixed` is what the context has already
 * decided (the picker queries `type=snapshot`): a group whose filters it fixes
 * is left out. A facet group with no options and nothing selected is left out
 * too: it would be an empty heading.
 */
export function visibleFilterGroups(
  facets: CatalogueFacets,
  filters: CatalogueFilterState,
  fixed: Partial<CatalogueFilterState> = {}
): CatalogueFilterGroup[] {
  return CATALOGUE_FILTER_GROUPS.filter((group) => {
    if (groupFilterKeys(group).some((k) => k in fixed)) return false;
    if (group.kind !== "facet") return true;
    return facetGroupOptions(group.key, facets).length > 0 || filters[group.key].length > 0;
  });
}

/**
 * The groups of the Start screen's snapshot picker's compact panel: the flagged
 * ones (`picker`), without what the picker fixes, and only those with something
 * to list. The same definition and the same rules as the sidebar's. The "More
 * filters" dialog is not this list: it takes every group
 * (`visibleFilterGroups(…, SNAPSHOT_PICKER_FIXED_FILTERS)`).
 */
export function pickerFilterGroups(
  facets: CatalogueFacets,
  filters: CatalogueFilterState
): CatalogueFilterGroup[] {
  return visibleFilterGroups(facets, filters, SNAPSHOT_PICKER_FIXED_FILTERS).filter((g) => g.picker);
}

/**
 * The filter-state keys the picker reads and writes: those of every group of
 * the definition, flagged or not (the dialog offers them all), less what the
 * picker fixes.
 */
export function pickerFilterKeys(): (keyof CatalogueFilterState)[] {
  return CATALOGUE_FILTER_GROUPS.filter(
    (g) => !groupFilterKeys(g).some((k) => k in SNAPSHOT_PICKER_FIXED_FILTERS)
  ).flatMap(groupFilterKeys);
}

/**
 * How many filters are on in groups the picker's compact panel does not show:
 * the ones only the "More filters" dialog has. What its button's badge counts.
 */
export function countMoreFilters(filters: CatalogueFilterState): number {
  return CATALOGUE_FILTER_GROUPS.filter(
    (g) => !g.picker && !groupFilterKeys(g).some((k) => k in SNAPSHOT_PICKER_FIXED_FILTERS)
  ).reduce((n, g) => n + groupActiveCount(g, filters), 0);
}

/**
 * What the Start screen's snapshot picker fixes: it lists model snapshots, so
 * `type` is `snapshot`, in the query (`fetchSnapshots`) and not in the URL or
 * the filter state. A group this fixes is not offered.
 */
export const SNAPSHOT_PICKER_FIXED_FILTERS: Partial<CatalogueFilterState> = {
  type: ["snapshot"],
};

export const EMPTY_CATALOGUE_FILTERS: CatalogueFilterState = {
  searchQuery: "",
  type: [],
  tag: [],
  keyword: [],
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
  boxNorth: null,
  boxSouth: null,
  boxEast: null,
  boxWest: null,
  sortBy: "relevance",
  view: "list",
  page: 1,
};

export const EMPTY_CATALOGUE_FACETS: CatalogueFacets = {
  type: [],
  tag: [],
  keyword: [],
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

/** What "Reset" and "Clear all" set: every filter and the search off, the sort and the view kept, page 1. */
export function clearedFilters(filters: CatalogueFilterState): CatalogueFilterState {
  return { ...EMPTY_CATALOGUE_FILTERS, sortBy: filters.sortBy, view: filters.view };
}

/**
 * Filters in effect, not counting the search box: what the Filters badge shows.
 * A filter the context fixes (`fixed`) is not the user's and is not counted.
 */
export function countActiveFilters(
  filters: CatalogueFilterState,
  fixed: Partial<CatalogueFilterState> = {}
): number {
  let n = 0;
  for (const group of CATALOGUE_FILTER_GROUPS) {
    if (groupFilterKeys(group).some((k) => k in fixed)) continue;
    n += groupActiveCount(group, filters);
  }
  return n;
}

/** Anything at all narrowing the list, the search included. */
export function hasActiveFilters(
  filters: CatalogueFilterState,
  fixed: Partial<CatalogueFilterState> = {}
): boolean {
  return countActiveFilters(filters, fixed) > 0 || filters.searchQuery.trim() !== "";
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

/** One value of `about.tags`, from the snapshot spec's closed list. */
export type AboutTag = OpenGHMCitationBlock["tags"][number];

/** The label of each tag. Typed as a full record, so a tag added to the spec
 *  does not compile until it is named here. */
const TAG_LABELS: Record<AboutTag, string> = {
  publication: "Publication",
  tutorial: "Tutorial",
  test: "Test",
  "ancillary-data": "Ancillary data",
  "climate-forcing": "Climate forcing",
  "river-network": "River network",
};

/** Every tag the spec allows, in the order the list reads. */
export const ABOUT_TAGS = Object.keys(TAG_LABELS) as AboutTag[];

/** A tag as people read it: "ancillary-data" is "Ancillary data". The URL and the
 *  API keep the raw value; an unknown tag is capitalised with its hyphens spaced. */
export function humanizeTag(tag: string): string {
  const known = (TAG_LABELS as Record<string, string | undefined>)[tag];
  if (known) return known;
  const spaced = tag.replace(/[_-]+/g, " ").trim();
  if (!spaced) return tag;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A list of tags as one line of text: "Publication, Climate forcing". */
export function formatTags(tags: readonly string[]): string {
  return tags.map(humanizeTag).join(", ");
}

/** The text of one option: forcing roles and tags are humanised here, the rest come labelled. */
export function facetOptionLabel(key: CatalogueFacetKey, value: string, label?: string): string {
  if (key === "forcing") return humanizeForcing(value);
  if (key === "tag") return humanizeTag(value);
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

/** One chip per selected value, plus one each for the search, the years, the resolution and the region; none for a filter the context fixes. */
export function activeFilterChips(
  filters: CatalogueFilterState,
  facets: CatalogueFacets,
  fixed: Partial<CatalogueFilterState> = {}
): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];

  const q = filters.searchQuery.trim();
  if (q) chips.push({ id: "q", label: `Search: ‘${q}’`, remove: { searchQuery: "" } });

  for (const key of CATALOGUE_FACET_KEYS) {
    if (key in fixed) continue;
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
  const region = filterRegion(filters);
  if (region) {
    chips.push({
      id: "region",
      label: `Region: ${formatRegion(region)}`,
      remove: { boxNorth: null, boxSouth: null, boxEast: null, boxWest: null },
    });
  }
  return chips;
}
