"use client";

import { Search } from "lucide-react";
import {
  ModelInputFilterState,
  ModelInputListResponse,
} from "@/lib/repository/types";
import { fetchModelInputs } from "@/lib/repository/actions";
import { modelInputFiltersToParams, parseModelInputFilters } from "@/lib/repository/url-filters";
import { useUrlSyncedFilters } from "@/lib/repository/use-url-filters";
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
  initialFilters,
  initialData,
}: {
  initialFilters?: ModelInputFilterState;
  initialData: ModelInputListResponse;
}) {
  const { filters, setFilters, result, isPending } = useUrlSyncedFilters<
    ModelInputFilterState,
    ModelInputListResponse
  >({
    initialFilters: initialFilters ?? INITIAL_FILTERS,
    initialResult: initialData,
    emptyResult: EMPTY_RESULT,
    parse: parseModelInputFilters,
    serialize: modelInputFiltersToParams,
    fetcher: fetchModelInputs,
  });

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-8 lg:px-10 lg:py-10">
      <div className="w-full lg:w-64 lg:shrink-0">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={filters.searchQuery}
            onChange={(e) => setFilters({ searchQuery: e.target.value })}
            placeholder="Search model inputs…"
            className="h-9 w-full rounded-md border border-input bg-transparent pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <ModelInputResults
        modelInputs={result.items}
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
