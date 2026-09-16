"use client";

import { useCallback, useEffect, useRef, useTransition, useState } from "react";
import { FilterState, RepositoryListResponse, Dataset } from "@/lib/repository/types";
import { fetchDatasets } from "@/lib/repository/actions";
import { RepositorySidebar } from "./repository-sidebar";
import { RepositoryResults } from "./repository-results";

const INITIAL_FILTERS: FilterState = {
  searchQuery: "",
  datasetTypes: [],
  variableTypes: [],
  temporalCoverageStart: null,
  temporalCoverageEnd: null,
  spatialResMin: null,
  spatialResMax: null,
  temporalResolutions: [],
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
  initialData,
}: {
  initialData: RepositoryListResponse;
}) {
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [result, setResult] = useState<RepositoryListResponse>(initialData);
  const [isPending, startTransition] = useTransition();

  // Skip the very first effect run — initialData from SSR is already correct.
  // Without this, hydration triggers a redundant fetch 300ms after mount, causing a flicker.
  const isFirstRender = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doFetch = useCallback((nextFilters: FilterState) => {
    startTransition(async () => {
      try {
        const data = await fetchDatasets(nextFilters);
        setResult(data);
      } catch {
        setResult(EMPTY_RESULT);
      }
    });
  }, []);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doFetch(filters), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [filters, doFetch]);

  const handleFiltersChange = useCallback((updates: Partial<FilterState>) => {
    setFilters((prev) => {
      const next = { ...prev, ...updates };
      // Reset to page 1 on any filter change (except page itself)
      if (!("page" in updates)) {
        next.page = 1;
      }
      return next;
    });
  }, []);

  const handleClearAll = useCallback(() => {
    setFilters(INITIAL_FILTERS);
  }, []);

  return (
    <div className="mx-auto flex max-w-[1280px] gap-8 px-10 py-10">
      <RepositorySidebar
        filters={filters}
        onFiltersChange={handleFiltersChange}
        onClearAll={handleClearAll}
      />
      <RepositoryResults
        datasets={result.items as Dataset[]}
        totalCount={result.totalCount}
        sortBy={filters.sortBy}
        onSortChange={(sortBy) => handleFiltersChange({ sortBy })}
        page={filters.page}
        totalPages={result.totalPages}
        onPageChange={(page) => handleFiltersChange({ page })}
        isLoading={isPending}
      />
    </div>
  );
}
