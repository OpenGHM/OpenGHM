import { useRef } from "react";
import { CircleAlert, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { hasActiveFilters } from "@/lib/repository/catalogue";
import type {
  CatalogueFacets,
  CatalogueFilterState,
  CatalogueResponse,
} from "@/lib/repository/types";
import { ActiveFilterChips } from "./active-filter-chips";
import { CatalogueCard, CatalogueCardSkeleton } from "./catalogue-card";
import { CatalogueToolbar } from "./catalogue-toolbar";
import { Pagination } from "./pagination";

const SKELETON_COUNT = 3;
const GRID_SKELETON_COUNT = 6;

const LIST_CLASS = "flex flex-col gap-3.5";
const GRID_CLASS = "grid gap-3.5 md:grid-cols-2 xl:grid-cols-3";

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
    <div aria-live="polite" aria-atomic="true" className="text-[13.5px] text-muted-foreground">
      {isLoading ? (
        <>
          <span className="sr-only">Loading results</span>
          <Skeleton aria-hidden="true" className="inline-block h-4 w-24 align-middle" />
        </>
      ) : error ? (
        "Results unavailable"
      ) : (
        <>
          <strong className="font-semibold text-highlight">{totalCount}</strong>{" "}
          {totalCount === 1 ? "result" : "results"}
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
 * The right-hand side of the Data Repository: the toolbar (search, sort,
 * view), the result count with the active-filter chips, the cards as a list or
 * a grid (or the loading, empty or error state) and the pagination.
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
  onToggleTag,
  onToggleKeyword,
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
  /** A card's tag chip: add the tag to the filter, or take it off. */
  onToggleTag: (tag: string) => void;
  /** A card's keyword chip: add the keyword to the filter, or take it off. */
  onToggleKeyword: (keyword: string) => void;
}) {
  const countRef = useRef<HTMLDivElement>(null);
  const filtered = hasActiveFilters(filters);
  const grid = filters.view === "grid";

  return (
    <section aria-label="Results" className="flex min-w-0 flex-1 flex-col gap-4">
      <CatalogueToolbar filters={filters} onChange={onChange} />

      <div
        id="catalogue-results"
        ref={countRef}
        tabIndex={-1}
        className="flex min-h-7 scroll-mt-24 flex-wrap items-center gap-x-3 gap-y-2 outline-none"
      >
        <ResultCount
          totalCount={result.totalCount}
          searchQuery={filters.searchQuery}
          isLoading={isLoading}
          error={error}
        />
        <ActiveFilterChips
          filters={filters}
          facets={facets}
          onChange={onChange}
          onClearAll={onClearAll}
        />
      </div>

      {isLoading ? (
        <div aria-busy="true" className={grid ? GRID_CLASS : LIST_CLASS}>
          {Array.from({ length: grid ? GRID_SKELETON_COUNT : SKELETON_COUNT }).map((_, i) => (
            <CatalogueCardSkeleton key={i} view={filters.view} />
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
          <Button type="button" variant="outline" onClick={onRetry} className="h-10 rounded-lg sm:h-9">
            Retry
          </Button>
        </div>
      ) : result.items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
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
            <Button type="button" variant="outline" onClick={onClearAll} className="mt-2 h-10 rounded-lg sm:h-9">
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <ul className={grid ? GRID_CLASS : LIST_CLASS}>
          {result.items.map((item) => (
            <li key={`${item.kind}:${item.id}`} className="min-w-0">
              <CatalogueCard
                item={item}
                view={filters.view}
                selectedTags={filters.tag}
                selectedKeywords={filters.keyword}
                onToggleTag={(tag) => {
                  onToggleTag(tag);
                  // Same as a keyword chip: keep the focus on the result count.
                  countRef.current?.focus({ preventScroll: true });
                }}
                onToggleKeyword={(keyword) => {
                  onToggleKeyword(keyword);
                  // The list is replaced while it reloads, which would drop the
                  // focus of the chip that was pressed; keep it on the result count.
                  countRef.current?.focus({ preventScroll: true });
                }}
              />
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
