"use client";

import { useCallback, useEffect, useRef, useTransition, useState } from "react";
import { Search } from "lucide-react";
import {
  ModelInputFilterState,
  ModelInputListResponse,
} from "@/lib/repository/types";
import { fetchModelInputs } from "@/lib/repository/actions";
import { ModelInputResults } from "./model-input-results";

const INITIAL_FILTERS: ModelInputFilterState = {
  searchQuery: "",
  sortBy: "relevance",
  page: 1,
};

const EMPTY_RESULT: ModelInputListResponse = {
  items: [],
  totalCount: 0,
  totalPages: 1,
  page: 1,
};

export function ModelInputsClient({
  initialData,
}: {
  initialData: ModelInputListResponse;
}) {
  const [filters, setFilters] = useState<ModelInputFilterState>(INITIAL_FILTERS);
  const [result, setResult] = useState<ModelInputListResponse>(initialData);
  const [isPending, startTransition] = useTransition();

  // Same reasoning as RepositoryClient: SSR's initialData is already
  // correct, so the first effect run would be a redundant fetch.
  const isFirstRender = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doFetch = useCallback((nextFilters: ModelInputFilterState) => {
    startTransition(async () => {
      try {
        const data = await fetchModelInputs(nextFilters);
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

  const handleFiltersChange = useCallback((updates: Partial<ModelInputFilterState>) => {
    setFilters((prev) => {
      const next = { ...prev, ...updates };
      if (!("page" in updates)) {
        next.page = 1;
      }
      return next;
    });
  }, []);

  return (
    <div className="mx-auto flex max-w-[1280px] gap-8 px-10 py-10">
      <div className="w-64 shrink-0">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={filters.searchQuery}
            onChange={(e) => handleFiltersChange({ searchQuery: e.target.value })}
            placeholder="Search model inputs…"
            className="h-9 w-full rounded-md border border-input bg-transparent pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <ModelInputResults
        modelInputs={result.items}
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
