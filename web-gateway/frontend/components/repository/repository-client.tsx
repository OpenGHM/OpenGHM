"use client";

import { useCallback, useEffect, useState } from "react";
import { FilterState, RepositoryListResponse } from "@/lib/repository/types";
import { fetchDatasets, fetchModelInputIds } from "@/lib/repository/actions";
import { datasetFiltersToParams, parseDatasetFilters } from "@/lib/repository/url-filters";
import { useUrlSyncedFilters } from "@/lib/repository/use-url-filters";
import { RepositorySidebar } from "./repository-sidebar";
import { RepositoryResults } from "./repository-results";

const INITIAL_FILTERS: FilterState = {
  searchQuery: "",
  temporalCoverageStart: null,
  temporalCoverageEnd: null,
  spatialResMin: null,
  spatialResMax: null,
  sortBy: "relevance",
  page: 1,
};

const EMPTY_RESULT: RepositoryListResponse = {
  items: [],
  totalCount: 0,
  totalPages: 1,
  page: 1,
};

export function RepositoryClient({
  initialFilters,
  initialData,
}: {
  initialFilters?: FilterState;
  initialData: RepositoryListResponse;
}) {
  const { filters, setFilters, result, isPending } = useUrlSyncedFilters<
    FilterState,
    RepositoryListResponse
  >({
    initialFilters: initialFilters ?? INITIAL_FILTERS,
    initialResult: initialData,
    emptyResult: EMPTY_RESULT,
    parse: parseDatasetFilters,
    serialize: datasetFiltersToParams,
    fetcher: fetchDatasets,
  });

  const handleClearAll = useCallback(() => {
    setFilters(INITIAL_FILTERS);
  }, [setFilters]);

  const [modelInputIds, setModelInputIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchModelInputIds()
      .then((ids) => {
        if (!cancelled) setModelInputIds(ids);
      })
      .catch(() => {
        // Badge degrades to "Checking…" forever rather than throwing —
        // the table itself is more important than the badge.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-8 lg:px-10 lg:py-10">
      <RepositorySidebar
        filters={filters}
        onFiltersChange={setFilters}
        onClearAll={handleClearAll}
      />
      <RepositoryResults
        datasets={result.items}
        modelInputIds={modelInputIds}
        totalCount={result.totalCount}
        sortBy={filters.sortBy}
        onSortChange={(sortBy) => setFilters({ sortBy })}
        page={filters.page}
        totalPages={result.totalPages}
        onPageChange={(page) => setFilters({ page })}
        isLoading={isPending}
      />
    </div>
  );
}
