/**
 * URL ⇄ filter-state conversion for the repository catalogue and the
 * Start screen's snapshot picker (`/workspace/new`), which shares the
 * catalogue's query. This is the fix for open item 16: a search result is only
 * linkable/bookmarkable if the URL is the source of truth for the filters,
 * not a `useState` seeded once from it.
 *
 * Every param name here matches what the backend route actually accepts
 * (`app/api/v1/repository.py`'s `list_catalogue`) — `q`, `year_start`,
 * `year_end`, `spatial_res_min`, `spatial_res_max`, `sort`, `page`, and the
 * repeatable facet keys — so a shared link is also a valid direct API call
 * shape, not a second vocabulary to translate.
 */
import {
  CATALOGUE_FACET_KEYS,
  EMPTY_CATALOGUE_FILTERS,
  pickerFilterKeys,
} from "./catalogue";
import type {
  CatalogueFilterState,
  CatalogueKind,
  CatalogueSortOption,
  CatalogueView,
  SortOption,
} from "./types";

const SORT_OPTIONS: readonly SortOption[] = ["relevance", "newest", "title-az", "title-za"];

function parseNumberParam(v: string | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parsePageParam(v: string | null): number {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * Next's `searchParams` prop is `{[key: string]: string | string[] | undefined}`,
 * not a `URLSearchParams` — this is the one conversion point so server
 * components and the client hook read the exact same shape.
 */
export function toURLSearchParams(
  sp: Record<string, string | string[] | undefined>
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (value === undefined) continue;
    // A repeated key (`?tag=a&tag=b`) arrives as an array: keep every value.
    for (const v of Array.isArray(value) ? value : [value]) params.append(key, v);
  }
  return params;
}

// ─── Catalogue ──────────────────────────────────────────────────────────────

const CATALOGUE_SORT_OPTIONS: readonly CatalogueSortOption[] = [...SORT_OPTIONS, "coverage-start"];

function parseCatalogueSort(v: string | null): CatalogueSortOption {
  return v !== null && (CATALOGUE_SORT_OPTIONS as readonly string[]).includes(v)
    ? (v as CatalogueSortOption)
    : "relevance";
}

function parseView(v: string | null): CatalogueView {
  return v === "grid" ? "grid" : "list";
}

const CATALOGUE_KINDS: readonly CatalogueKind[] = ["snapshot", "model-input"];

/** Every non-empty value of a repeated key, once each, in URL order. */
function allValues(params: URLSearchParams, key: string): string[] {
  return [...new Set(params.getAll(key).filter((v) => v !== ""))];
}

export function parseCatalogueFilters(params: URLSearchParams): CatalogueFilterState {
  const state: CatalogueFilterState = {
    ...EMPTY_CATALOGUE_FILTERS,
    searchQuery: params.get("q") ?? "",
    yearStart: parseNumberParam(params.get("year_start")),
    yearEnd: parseNumberParam(params.get("year_end")),
    spatialResMin: parseNumberParam(params.get("spatial_res_min")),
    spatialResMax: parseNumberParam(params.get("spatial_res_max")),
    sortBy: parseCatalogueSort(params.get("sort")),
    view: parseView(params.get("view")),
    page: parsePageParam(params.get("page")),
  };
  for (const key of CATALOGUE_FACET_KEYS) state[key] = allValues(params, key);
  // An unknown `type` would make the backend answer 422 for the whole page.
  state.type = state.type.filter((v) => (CATALOGUE_KINDS as readonly string[]).includes(v));
  return state;
}

/** Repeated keys, one per value: `?tag=a&tag=b`, never a comma list. */
export function catalogueFiltersToParams(filters: CatalogueFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.searchQuery.trim()) params.set("q", filters.searchQuery.trim());
  for (const key of CATALOGUE_FACET_KEYS) {
    for (const value of filters[key]) params.append(key, value);
  }
  if (filters.yearStart != null) params.set("year_start", String(filters.yearStart));
  if (filters.yearEnd != null) params.set("year_end", String(filters.yearEnd));
  if (filters.spatialResMin != null) params.set("spatial_res_min", String(filters.spatialResMin));
  if (filters.spatialResMax != null) params.set("spatial_res_max", String(filters.spatialResMax));
  if (filters.sortBy !== "relevance") params.set("sort", filters.sortBy);
  if (filters.view !== "list") params.set("view", filters.view);
  if (filters.page !== 1) params.set("page", String(filters.page));
  return params;
}

// ─── The Start screen's snapshot picker ─────────────────────────────────────

/**
 * The picker's filters from the URL: the search, the page and the filters of
 * the groups it offers (`pickerFilterKeys`, the groups flagged `picker` in
 * `CATALOGUE_FILTER_GROUPS`). The rest of a link copied from the repository (a
 * keyword, a sort, the type the fetch fixes) is dropped, because the picker
 * could not show it or take it off.
 */
export function parsePickerFilters(params: URLSearchParams): CatalogueFilterState {
  const all = parseCatalogueFilters(params);
  const state: CatalogueFilterState = {
    ...EMPTY_CATALOGUE_FILTERS,
    searchQuery: all.searchQuery,
    page: all.page,
  };
  for (const key of pickerFilterKeys()) Object.assign(state, { [key]: all[key] });
  return state;
}

/** The picker's filters as a query string: the catalogue's own, in the same
 *  keys; the picker's state only holds its own. */
export const pickerFiltersToParams = catalogueFiltersToParams;
