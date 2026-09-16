/**
 * Client-side filter/sort/paginate utilities.
 * NOTE: These are no longer used in repository-client.tsx (filtering is now
 * handled by the FastAPI backend). Kept for reference and potential reuse.
 */
import { Dataset, FilterState, SortOption, isSnapshot } from "./types";
import { ITEMS_PER_PAGE } from "./data";

function extractYear(dateStr: string): number {
  const match = dateStr.match(/(\d{4})/);
  return match ? parseInt(match[1]) : 0;
}

function getTemporalYears(coverage: string): [number, number] {
  if (coverage === "static") return [0, 9999];
  const parts = coverage.split("/");
  return [extractYear(parts[0]), extractYear(parts[1] || parts[0])];
}

export function filterDatasets(datasets: Dataset[], filters: FilterState): Dataset[] {
  return datasets.filter((d) => {
    // Text search
    if (filters.searchQuery) {
      const q = filters.searchQuery.toLowerCase();
      const variableNames = isSnapshot(d) ? d.variablesMeasured.map((v) => v.name) : [];
      const searchable = [
        d.title,
        d.description,
        ...d.keywords,
        ...d.creators.map((c) => c.name),
        ...variableNames,
      ]
        .join(" ")
        .toLowerCase();
      if (!searchable.includes(q)) return false;
    }

    // Dataset type filter
    if (filters.datasetTypes.length > 0) {
      if (!filters.datasetTypes.includes(d.datasetType)) return false;
    }

    // Variable types filter (Snapshot only)
    if (filters.variableTypes.length > 0) {
      if (!isSnapshot(d)) return false;
      const vars = d.variablesMeasured.map((v) => v.name);
      if (!filters.variableTypes.some((vt) => vars.includes(vt))) return false;
    }

    // Temporal coverage range
    if (filters.temporalCoverageStart != null || filters.temporalCoverageEnd != null) {
      const [start, end] = getTemporalYears(d.temporalCoverage);
      if (start !== 0 && end !== 9999) {
        if (filters.temporalCoverageStart != null && end < filters.temporalCoverageStart) return false;
        if (filters.temporalCoverageEnd != null && start > filters.temporalCoverageEnd) return false;
      }
    }

    // Temporal resolution
    if (filters.temporalResolutions.length > 0) {
      if (!d.temporalResolution || !filters.temporalResolutions.includes(d.temporalResolution)) {
        return false;
      }
    }

    // Spatial resolution (degrees)
    if (filters.spatialResMin !== null || filters.spatialResMax !== null) {
      const deg = d.spatialResolutionDegrees;
      if (deg != null) {
        if (filters.spatialResMin !== null && deg < filters.spatialResMin) return false;
        if (filters.spatialResMax !== null && deg > filters.spatialResMax) return false;
      }
    }

    return true;
  });
}

export function sortDatasets(datasets: Dataset[], sortBy: SortOption): Dataset[] {
  const sorted = [...datasets];
  switch (sortBy) {
    case "newest":
      return sorted.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
    case "title-az":
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    case "title-za":
      return sorted.sort((a, b) => b.title.localeCompare(a.title));
    case "relevance":
    default:
      return sorted;
  }
}

export function paginateDatasets(
  datasets: Dataset[],
  page: number,
  perPage: number = ITEMS_PER_PAGE
): { items: Dataset[]; totalPages: number; totalCount: number } {
  const totalCount = datasets.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const start = (page - 1) * perPage;
  const items = datasets.slice(start, start + perPage);
  return { items, totalPages, totalCount };
}
