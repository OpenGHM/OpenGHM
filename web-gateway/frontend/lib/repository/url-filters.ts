/**
 * URL ⇄ filter-state conversion for the two repository lists (datasets,
 * model inputs) and the new-simulation snapshot picker, which shares the
 * dataset list. This is the fix for open item 16: a search result is only
 * linkable/bookmarkable if the URL is the source of truth for the filters,
 * not a `useState` seeded once from it.
 *
 * Every param name here matches what the backend route actually accepts
 * (`app/api/v1/repository.py`'s `list_datasets` / `list_model_inputs`) —
 * `q`, `year_start`, `year_end`, `spatial_res_min`, `spatial_res_max`,
 * `sort`, `page` — so a shared link is also a valid direct API call shape,
 * not a second vocabulary to translate.
 */
import type { FilterState, ModelInputFilterState, SortOption } from "./types";

const SORT_OPTIONS: readonly SortOption[] = ["relevance", "newest", "title-az", "title-za"];

function isSortOption(v: string | null): v is SortOption {
  return v !== null && (SORT_OPTIONS as readonly string[]).includes(v);
}

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
    const single = Array.isArray(value) ? value[0] : value;
    if (single !== undefined) params.set(key, single);
  }
  return params;
}

// ─── Datasets ───────────────────────────────────────────────────────────────

export function parseDatasetFilters(params: URLSearchParams): FilterState {
  return {
    searchQuery: params.get("q") ?? "",
    temporalCoverageStart: parseNumberParam(params.get("year_start")),
    temporalCoverageEnd: parseNumberParam(params.get("year_end")),
    spatialResMin: parseNumberParam(params.get("spatial_res_min")),
    spatialResMax: parseNumberParam(params.get("spatial_res_max")),
    sortBy: isSortOption(params.get("sort")) ? (params.get("sort") as SortOption) : "relevance",
    page: parsePageParam(params.get("page")),
  };
}

export function datasetFiltersToParams(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.searchQuery.trim()) params.set("q", filters.searchQuery.trim());
  if (filters.temporalCoverageStart != null) params.set("year_start", String(filters.temporalCoverageStart));
  if (filters.temporalCoverageEnd != null) params.set("year_end", String(filters.temporalCoverageEnd));
  if (filters.spatialResMin != null) params.set("spatial_res_min", String(filters.spatialResMin));
  if (filters.spatialResMax != null) params.set("spatial_res_max", String(filters.spatialResMax));
  if (filters.sortBy !== "relevance") params.set("sort", filters.sortBy);
  if (filters.page !== 1) params.set("page", String(filters.page));
  return params;
}

// ─── Model inputs ───────────────────────────────────────────────────────────

export function parseModelInputFilters(params: URLSearchParams): ModelInputFilterState {
  return {
    searchQuery: params.get("q") ?? "",
    sortBy: isSortOption(params.get("sort")) ? (params.get("sort") as SortOption) : "relevance",
    page: parsePageParam(params.get("page")),
  };
}

export function modelInputFiltersToParams(filters: ModelInputFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.searchQuery.trim()) params.set("q", filters.searchQuery.trim());
  if (filters.sortBy !== "relevance") params.set("sort", filters.sortBy);
  if (filters.page !== 1) params.set("page", String(filters.page));
  return params;
}
