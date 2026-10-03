"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActiveFilterChips } from "@/components/repository/active-filter-chips";
import { Pagination } from "@/components/repository/pagination";
import { SnapshotDetailSheet } from "./snapshot-detail-sheet";
import { SnapshotGrid } from "./snapshot-grid";
import { SnapshotPickerFilters } from "./snapshot-picker-filters";
import { fetchModelInputIds, fetchSnapshots } from "@/lib/repository/actions";
import { clearedFilters, EMPTY_CATALOGUE, hasActiveFilters } from "@/lib/repository/catalogue";
import { parsePickerFilters, pickerFiltersToParams } from "@/lib/repository/url-filters";
import { useUrlSyncedFilters } from "@/lib/repository/use-url-filters";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { cn } from "@/lib/utils";
import type { CatalogueFilterState, CatalogueResponse, Dataset } from "@/lib/repository/types";

/**
 * The Start screen's model snapshot picker (step 1 of the draft wizard): the
 * Data Repository's search and filters in one toolbar (`SnapshotPickerFilters`),
 * the number of snapshots it found with what is narrowing it, a grid of cards
 * (`SnapshotGrid`) in which a click selects, pages, and a Details sheet in place
 * of navigation (spec.md's table: browse gets the detail page, the picker gets a
 * sheet and a commit control). Selecting hands the chosen dataset to
 * `onSelect`; nothing is created here.
 *
 * Search and filters are always there: the catalogue is meant to grow past what
 * a glance takes in. They run the repository's own query for snapshots
 * (`fetchSnapshots`), and sit in the URL. A search is ordered by the
 * repository's relevance; with none, and everything on one page, the snapshots
 * the user has used (`usedIds`) come first, and are marked either way.
 */
export function SnapshotPicker({
  initialFilters,
  initialData,
  initialError = false,
  initialModelInputIds,
  usedIds,
  onSelect,
  pendingId = null,
  disabled = false,
}: {
  initialFilters: CatalogueFilterState;
  initialData: CatalogueResponse;
  /** The server could not read `initialData`: start in the error state. */
  initialError?: boolean;
  initialModelInputIds: Set<string> | null;
  /** Ids of the snapshots the caller has used: marked, and listed first when nothing else orders the list. */
  usedIds: ReadonlySet<string>;
  onSelect: (dataset: Dataset) => void;
  /** The snapshot whose draft is being created, if any. */
  pendingId?: string | null;
  /** Every card is off while a draft is being created. */
  disabled?: boolean;
}) {
  const { filters, setFilters, result, isPending, error, retry } = useUrlSyncedFilters<
    CatalogueFilterState,
    CatalogueResponse
  >({
    initialFilters,
    initialResult: initialData,
    emptyResult: EMPTY_CATALOGUE,
    parse: parsePickerFilters,
    serialize: pickerFiltersToParams,
    fetcher: fetchSnapshots,
    initialError,
  });

  // A failed fetch comes back empty. The filters keep the last facets they were
  // given, so the panel does not lose its tags while the list asks for a retry.
  const [facets, setFacets] = useState(initialData.facets);
  const [seen, setSeen] = useState(result);
  if (result !== seen) {
    setSeen(result);
    if (!error) setFacets(result.facets);
  }

  // A refetch keeps the list and the count on screen; they dim only if the
  // answer takes a while.
  const busy = useDelayedFlag(isPending);

  const [modelInputIds, setModelInputIds] = useState<Set<string> | null>(initialModelInputIds);
  useEffect(() => {
    if (initialModelInputIds !== null) return;
    let cancelled = false;
    fetchModelInputIds()
      .then((ids) => {
        if (!cancelled) setModelInputIds(ids);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The snapshot in the sheet is the one that was opened, not a row looked up
  // in the current page: a refetch behind the sheet does not take it away. It
  // stays set while the sheet slides out.
  const [detail, setDetail] = useState<Dataset | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const openDetails = (dataset: Dataset) => {
    setDetail(dataset);
    setDetailOpen(true);
  };
  // Closed first, so an error from the draft is not left behind the sheet.
  const selectFromSheet = (dataset: Dataset) => {
    setDetailOpen(false);
    onSelect(dataset);
  };

  const resultsRef = useRef<HTMLDivElement>(null);
  const filtered = hasActiveFilters(filters);
  const query = filters.searchQuery.trim();
  const clear = () => setFilters(clearedFilters(filters));
  // `type=snapshot` leaves nothing else, but the type says so.
  const snapshots = result.items.filter((item): item is Dataset & { kind: "snapshot" } => item.kind === "snapshot");
  // Used snapshots lead only a list with no order of its own to keep: not a
  // search (relevance ranks it) and not one that goes on over several pages
  // (the first would be reordered on every page, and none across them).
  const usedFirst = query === "" && result.totalPages <= 1;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <SnapshotPickerFilters filters={filters} facets={facets} onChange={setFilters} />

      <div ref={resultsRef} className="flex min-h-7 scroll-mt-24 flex-wrap items-center gap-x-3 gap-y-2">
        <p
          aria-live="polite"
          aria-atomic="true"
          className={cn(
            "text-[13.5px] text-muted-foreground transition-opacity duration-200",
            busy && "opacity-60"
          )}
        >
          {error ? (
            "Model snapshots unavailable"
          ) : (
            <>
              <strong className="font-semibold text-highlight">{result.totalCount}</strong> model snapshot
              {result.totalCount !== 1 ? "s" : ""}
              {query && (
                <>
                  {" "}
                  for <span className="font-medium text-foreground">‘{query}’</span>
                </>
              )}
            </>
          )}
          {busy && <span className="sr-only"> Loading results</span>}
        </p>
        <ActiveFilterChips filters={filters} facets={facets} onChange={setFilters} onClearAll={clear} />
      </div>

      <div
        aria-busy={busy ? "true" : undefined}
        className={cn("min-w-0 transition-opacity duration-200", busy && "opacity-60")}
      >
        {error ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-5 sm:flex-row sm:items-center"
          >
            <CircleAlert aria-hidden="true" className="size-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-destructive">Model snapshots could not be loaded</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Check your connection and try again. Your search and filters are kept.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={retry} className="h-10 rounded-lg sm:h-9">
              Retry
            </Button>
          </div>
        ) : snapshots.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
            <SearchX aria-hidden="true" className="size-10 text-muted-foreground/60" />
            <h3 className="text-lg font-semibold text-foreground">
              {filtered ? "No model snapshots match" : "No model snapshots have been published yet"}
            </h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              {filtered
                ? "Remove a filter or change the search to see more."
                : "Published model snapshots will appear here."}
            </p>
            {filtered && (
              <Button type="button" variant="outline" onClick={clear} className="mt-2 h-10 rounded-lg sm:h-9">
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <SnapshotGrid
            datasets={snapshots}
            usedIds={usedIds}
            usedFirst={usedFirst}
            onDetails={openDetails}
            onSelect={onSelect}
            pendingId={pendingId}
            disabled={disabled}
          />
        )}
        {!error && (
          <Pagination
            page={filters.page}
            totalPages={result.totalPages}
            onPageChange={(page) => {
              setFilters({ page });
              resultsRef.current?.scrollIntoView?.({ block: "start" });
            }}
          />
        )}
      </div>

      {detail && (
        <SnapshotDetailSheet
          dataset={detail}
          open={detailOpen}
          modelInputIds={modelInputIds}
          onOpenChange={setDetailOpen}
          action={
            <Button onClick={() => selectFromSheet(detail)} className="h-10 font-semibold sm:h-9">
              <CheckCircle2 className="mr-1.5 size-4" aria-hidden="true" />
              Select
            </Button>
          }
        />
      )}
    </div>
  );
}
