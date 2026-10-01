import { CircleAlert, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { hasActiveFilters } from "@/lib/repository/catalogue";
import type {
  CatalogueFacets,
  CatalogueFilterState,
  CatalogueResponse,
  SortOption,
} from "@/lib/repository/types";
import { ActiveFilterChips } from "./active-filter-chips";
import { CatalogueCard, CatalogueCardSkeleton } from "./catalogue-card";
import { Pagination } from "./pagination";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "newest", label: "Newest first" },
  { value: "title-az", label: "Title A–Z" },
  { value: "title-za", label: "Title Z–A" },
];

const SKELETON_COUNT = 3;

function ResultCount({
  totalCount,
  searchQuery,
  isLoading,
  error,
}: {
  totalCount: number;
  searchQuery: string;
  isLoading: boolean;
  error: boolean;
}) {
  const q = searchQuery.trim();
  return (
    <div aria-live="polite" aria-atomic="true" className="mt-1 text-sm text-muted-foreground">
      {isLoading ? (
        <>
          <span className="sr-only">Loading results</span>
          <Skeleton aria-hidden="true" className="inline-block h-4 w-28 align-middle" />
        </>
      ) : error ? (
        "Results unavailable"
      ) : (
        <>
          {totalCount} {totalCount === 1 ? "result" : "results"} found
          {q && (
            <>
              {" "}
              for <span className="font-medium text-foreground">‘{q}’</span>
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The right-hand side of the Data Repository: the title and result count, the
 * sort, the active-filter chips, the cards (or the loading, empty or error
 * state) and the pagination.
 */
export function CatalogueResults({
  result,
  filters,
  facets,
  isLoading,
  error,
  onChange,
  onClearAll,
  onRetry,
}: {
  result: CatalogueResponse;
  filters: CatalogueFilterState;
  /** The facets the chips take their labels from. */
  facets: CatalogueFacets;
  isLoading: boolean;
  error: boolean;
  onChange: (updates: Partial<CatalogueFilterState>) => void;
  onClearAll: () => void;
  onRetry: () => void;
}) {
  const filtered = hasActiveFilters(filters);

  return (
    <section aria-label="Results" className="min-w-0 flex-1">
      <div id="catalogue-results" className="mb-4 flex scroll-mt-24 flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Data Repository</h1>
          <ResultCount
            totalCount={result.totalCount}
            searchQuery={filters.searchQuery}
            isLoading={isLoading}
            error={error}
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="catalogue-sort" className="text-sm text-muted-foreground">
            Sort by
          </label>
          <select
            id="catalogue-sort"
            value={filters.sortBy}
            onChange={(e) => onChange({ sortBy: e.target.value as SortOption })}
            className="h-10 rounded-md border border-input bg-card px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-9"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ActiveFilterChips
        filters={filters}
        facets={facets}
        onChange={onChange}
        onClearAll={onClearAll}
      />

      {isLoading ? (
        <div aria-busy="true" className="space-y-4">
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <CatalogueCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-5 sm:flex-row sm:items-center"
        >
          <CircleAlert aria-hidden="true" className="size-5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-destructive">The repository could not be loaded</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Check your connection and try again. Your filters are kept.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={onRetry} className="h-10 sm:h-9">
            Retry
          </Button>
        </div>
      ) : result.items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-card/50 px-6 py-14 text-center">
          <SearchX aria-hidden="true" className="size-10 text-muted-foreground/60" />
          <h2 className="text-lg font-semibold text-foreground">
            {filtered ? "No results match these filters" : "Nothing has been published yet"}
          </h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            {filtered
              ? "Remove a filter or change the search to see more."
              : "Published model snapshots and model inputs will appear here."}
          </p>
          {filtered && (
            <Button type="button" variant="outline" onClick={onClearAll} className="mt-2 h-10 sm:h-9">
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <ul className="space-y-4">
          {result.items.map((item) => (
            <li key={`${item.kind}:${item.id}`}>
              <CatalogueCard item={item} />
            </li>
          ))}
        </ul>
      )}

      {!isLoading && !error && (
        <Pagination
          page={filters.page}
          totalPages={result.totalPages}
          onPageChange={(page) => {
            onChange({ page });
            document.getElementById("catalogue-results")?.scrollIntoView?.({ block: "start" });
          }}
        />
      )}
    </section>
  );
}
