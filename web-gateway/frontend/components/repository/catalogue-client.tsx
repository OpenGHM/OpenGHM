"use client";

import { useState } from "react";
import { clearedFilters, EMPTY_CATALOGUE } from "@/lib/repository/catalogue";
import { fetchCatalogue } from "@/lib/repository/actions";
import { catalogueFiltersToParams, parseCatalogueFilters } from "@/lib/repository/url-filters";
import { useUrlSyncedFilters } from "@/lib/repository/use-url-filters";
import type { CatalogueFilterState, CatalogueResponse } from "@/lib/repository/types";
import { CatalogueResults } from "./catalogue-results";
import { CatalogueSidebar } from "./catalogue-sidebar";

/**
 * The Data Repository: the filter sidebar and the card list over one
 * catalogue of snapshots and model inputs, kept in step with the URL.
 */
export function CatalogueClient({
  initialFilters,
  initialData,
  initialError = false,
}: {
  initialFilters: CatalogueFilterState;
  initialData: CatalogueResponse;
  /** The server could not fetch `initialData`. */
  initialError?: boolean;
}) {
  const { filters, setFilters, result, isPending, error, retry } = useUrlSyncedFilters<
    CatalogueFilterState,
    CatalogueResponse
  >({
    initialFilters,
    initialResult: initialData,
    emptyResult: EMPTY_CATALOGUE,
    parse: parseCatalogueFilters,
    serialize: catalogueFiltersToParams,
    fetcher: fetchCatalogue,
    initialError,
  });

  // A failed fetch comes back empty. The sidebar keeps the last facets it was
  // given, so the filters do not vanish while the list asks for a retry.
  const [facets, setFacets] = useState(initialData.facets);
  const [seen, setSeen] = useState(result);
  if (result !== seen) {
    setSeen(result);
    if (!error) setFacets(result.facets);
  }

  const handleClearAll = () => setFilters(clearedFilters(filters));
  const handleToggleKeyword = (keyword: string) =>
    setFilters({
      keyword: filters.keyword.includes(keyword)
        ? filters.keyword.filter((k) => k !== keyword)
        : [...filters.keyword, keyword],
    });

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-8 lg:px-10 lg:py-10">
      <CatalogueSidebar
        filters={filters}
        facets={facets}
        onChange={setFilters}
        onClearAll={handleClearAll}
      />
      <CatalogueResults
        result={result}
        filters={filters}
        facets={facets}
        isLoading={isPending}
        error={error}
        onChange={setFilters}
        onClearAll={handleClearAll}
        onRetry={retry}
        onToggleKeyword={handleToggleKeyword}
      />
    </div>
  );
}
