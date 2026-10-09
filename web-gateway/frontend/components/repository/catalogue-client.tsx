"use client";

import { useState, type ReactNode } from "react";
import { PageBody } from "@/components/layout/page-hero";
import { clearedFilters, EMPTY_CATALOGUE } from "@/lib/repository/catalogue";
import { fetchCatalogue } from "@/lib/repository/actions";
import { catalogueFiltersToParams, parseCatalogueFilters } from "@/lib/repository/url-filters";
import { useUrlSyncedFilters } from "@/lib/repository/use-url-filters";
import type { CatalogueFilterState, CatalogueResponse } from "@/lib/repository/types";
import { CatalogueResults } from "./catalogue-results";
import { CatalogueSearchProvider } from "./catalogue-search";
import { CatalogueSidebar } from "./catalogue-sidebar";

/**
 * Filter keys that are in the URL but do not change the results: switching the
 * view neither goes back to page 1 nor asks the backend again.
 */
const INERT_KEYS = ["view"] as const;

/**
 * The Data Repository: the page's band (`hero`, which holds the search box),
 * then the filter sidebar and the card list over one catalogue of snapshots and
 * model inputs, kept in step with the URL.
 */
export function CatalogueClient({
  hero,
  initialFilters,
  initialData,
  initialError = false,
}: {
  /** The navy band. It sits inside the search provider, so its search box edits this catalogue's query. */
  hero: ReactNode;
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
    inertKeys: INERT_KEYS,
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
  const handleToggleTag = (tag: string) =>
    setFilters({
      tag: filters.tag.includes(tag) ? filters.tag.filter((t) => t !== tag) : [...filters.tag, tag],
    });
  const handleToggleKeyword = (keyword: string) =>
    setFilters({
      keyword: filters.keyword.includes(keyword)
        ? filters.keyword.filter((k) => k !== keyword)
        : [...filters.keyword, keyword],
    });

  return (
    <CatalogueSearchProvider
      query={filters.searchQuery}
      onQueryChange={(searchQuery) => setFilters({ searchQuery })}
    >
      {hero}
      <PageBody>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">
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
            onToggleTag={handleToggleTag}
            onToggleKeyword={handleToggleKeyword}
          />
        </div>
      </PageBody>
    </CatalogueSearchProvider>
  );
}
