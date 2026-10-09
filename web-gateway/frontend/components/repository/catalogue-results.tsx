import { useRef } from "react";
import { CircleAlert, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { hasActiveFilters } from "@/lib/repository/catalogue";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { cn } from "@/lib/utils";
import type {
  CatalogueFacets,
  CatalogueFilterState,
  CatalogueResponse,
} from "@/lib/repository/types";
import { ActiveFilterChips } from "./active-filter-chips";
import { CARD_GRID_CLASS, CatalogueCard, CatalogueCardSkeleton } from "./catalogue-card";
import { CatalogueToolbar } from "./catalogue-toolbar";
import { Pagination } from "./pagination";

const SKELETON_COUNT = 3;
const GRID_SKELETON_COUNT = 6;

const LIST_CLASS = "flex flex-col gap-3.5";
const GRID_CLASS = CARD_GRID_CLASS;

/** How long a refetch may take before the results on screen are dimmed. */
const BUSY_DELAY_MS = 300;

function ResultCount({
  totalCount,
  searchQuery,
  placeholder,
  busy,
  error,
}: {
  totalCount: number;
  searchQuery: string;
  /** Nothing to show yet: a skeleton stands in for the count. */
  placeholder: boolean;
  /** A refetch has been pending long enough to be announced. */
  busy: boolean;
  error: boolean;
}) {
  const q = searchQuery.trim();
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "text-sm text-foreground/80 transition-opacity duration-200",
        busy && "opacity-60"
      )}
    >
      {placeholder ? (
        <>
          <span className="sr-only">Loading results</span>
          <Skeleton
            aria-hidden="true"
            className="reveal-delayed inline-block h-4 w-24 align-middle"
          />
        </>
      ) : error ? (
        "Results unavailable"
      ) : (
        <>
          <strong className="text-xl font-bold tracking-[-0.02em] text-foreground">{totalCount}</strong>{" "}
          {totalCount === 1 ? "result" : "results"}
          {q && (
            <>
              {" "}
              for <span className="font-medium text-foreground">‘{q}’</span>
            </>
          )}
          {busy && <span className="sr-only"> Loading results</span>}
        </>
      )}
    </div>
  );
}

/**
 * The right-hand side of the Data Repository: one bar with the result count,
 * the active-filter chips, the sort and the list / grid switch, then the cards
 * as a list or a grid (or the empty or error state) and the pagination.
 *
 * A refetch keeps what is on screen. Only if it is still pending after 300 ms
 * are the count and cards dimmed and marked busy; a response that comes sooner
 * changes nothing until the new results replace the old. Placeholder cards are
 * for the one case with nothing to keep: a retry after a failed fetch.
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

  // A failed fetch leaves the empty result and the error box. Retrying has no
  // results to keep, so the list is a skeleton until the answer comes.
  const placeholder = isLoading && error;
  const busy = useDelayedFlag(isLoading && !placeholder, BUSY_DELAY_MS);

  return (
    <section aria-label="Results" className="flex min-w-0 flex-1 flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 rounded-[18px] bg-card py-2.5 pr-2.5 pl-[18px] shadow-raised">
        <div
          id="catalogue-results"
          ref={countRef}
          tabIndex={-1}
          className="min-h-7 scroll-mt-24 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ResultCount
            totalCount={result.totalCount}
            searchQuery={filters.searchQuery}
            placeholder={placeholder}
            busy={busy}
            error={error}
          />
        </div>
        <div className="min-w-0 flex-1">
          <ActiveFilterChips
            filters={filters}
            facets={facets}
            onChange={onChange}
            onClearAll={onClearAll}
          />
        </div>
        <CatalogueToolbar filters={filters} onChange={onChange} />
      </div>

      <div
        aria-busy={busy || placeholder ? "true" : undefined}
        className={cn("flex flex-col gap-4 transition-opacity duration-200", busy && "opacity-60")}
      >
        {placeholder ? (
          <div className={cn("reveal-delayed", grid ? GRID_CLASS : LIST_CLASS)}>
            {Array.from({ length: grid ? GRID_SKELETON_COUNT : SKELETON_COUNT }).map((_, i) => (
              <CatalogueCardSkeleton key={i} view={filters.view} />
            ))}
          </div>
        ) : error ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-card border border-destructive/30 bg-destructive/5 p-5 sm:flex-row sm:items-center"
          >
            <CircleAlert aria-hidden="true" className="size-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-destructive">The repository could not be loaded</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Check your connection and try again. Your filters are kept.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={onRetry} className="h-10 rounded-[11px] sm:h-9">
              Retry
            </Button>
          </div>
        ) : result.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-card bg-card px-6 py-14 text-center shadow-card">
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
              <Button type="button" onClick={onClearAll} className="mt-2 h-10 rounded-[11px] bg-hero px-4 font-semibold text-white hover:bg-hero/85 sm:h-9">
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
                    // The new results replace the list, which would drop the focus
                    // of the chip that was pressed; keep it on the result count.
                    countRef.current?.focus({ preventScroll: true });
                  }}
                />
              </li>
            ))}
          </ul>
        )}

        {!placeholder && !error && (
          <Pagination
            page={filters.page}
            totalPages={result.totalPages}
            onPageChange={(page) => {
              onChange({ page });
              document.getElementById("catalogue-results")?.scrollIntoView?.({ block: "start" });
            }}
          />
        )}
      </div>
    </section>
  );
}
