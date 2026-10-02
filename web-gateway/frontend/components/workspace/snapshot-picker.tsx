"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/repository/pagination";
import { SnapshotDetailSheet } from "./snapshot-detail-sheet";
import { SnapshotGrid } from "./snapshot-grid";
import {
  CLEARED_PICKER_FILTERS,
  hasPickerFilters,
  SnapshotPickerFilters,
} from "./snapshot-picker-filters";
import { fetchDatasets, fetchModelInputIds } from "@/lib/repository/actions";
import { datasetFiltersToParams, parseDatasetFilters } from "@/lib/repository/url-filters";
import { useUrlSyncedFilters } from "@/lib/repository/use-url-filters";
import { useDelayedFlag } from "@/lib/use-delayed-flag";
import { cn } from "@/lib/utils";
import type { Dataset, FilterState, RepositoryListResponse } from "@/lib/repository/types";

const EMPTY_RESULT: RepositoryListResponse = {
  items: [],
  totalCount: 0,
  totalPages: 1,
  page: 1,
};

/** Search and Filters are for a catalogue that has outgrown a glance: with this
 *  many snapshots or fewer they are not shown (unless something is already
 *  narrowing the list, or there is a second page). */
export const CONTROLS_THRESHOLD = 9;

/**
 * The Start screen's model snapshot picker (step 1 of the draft wizard): a grid
 * of cards (`SnapshotGrid`) in which a click selects, and a Details sheet in
 * place of navigation (spec.md's table: browse gets the detail page, the picker
 * gets a sheet and a commit control). Selecting hands the chosen dataset to
 * `onSelect`; nothing is created here.
 *
 * The Data Repository's search and filters (`useUrlSyncedFilters`, the year and
 * resolution controls) sit above the grid, but only once the catalogue has more
 * than `CONTROLS_THRESHOLD` snapshots, or a search or filter is already in the
 * URL, or there is more than one page: a short list is a list to look at, not
 * to search.
 */
export function SnapshotPicker({
  initialFilters,
  initialData,
  initialModelInputIds,
  usedIds,
  onSelect,
  pendingId = null,
  disabled = false,
}: {
  initialFilters: FilterState;
  initialData: RepositoryListResponse;
  initialModelInputIds: Set<string> | null;
  /** Ids of the snapshots the caller has used: marked, and listed first. */
  usedIds: ReadonlySet<string>;
  onSelect: (dataset: Dataset) => void;
  /** The snapshot whose draft is being created, if any. */
  pendingId?: string | null;
  /** Every card is off while a draft is being created. */
  disabled?: boolean;
}) {
  const { filters, setFilters, result, isPending } = useUrlSyncedFilters<
    FilterState,
    RepositoryListResponse
  >({
    initialFilters,
    initialResult: initialData,
    emptyResult: EMPTY_RESULT,
    parse: parseDatasetFilters,
    serialize: datasetFiltersToParams,
    fetcher: fetchDatasets,
  });

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

  const filtered = hasPickerFilters(filters);
  const showControls = filtered || result.totalCount > CONTROLS_THRESHOLD || result.totalPages > 1;
  const query = filters.searchQuery.trim();
  const reset = () => setFilters(CLEARED_PICKER_FILTERS);
  const resetButton = (
    <button
      type="button"
      onClick={reset}
      className="-mr-2 inline-flex h-10 items-center rounded-md px-2 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-8"
    >
      Reset
    </button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {showControls && (
        <>
          <SnapshotPickerFilters filters={filters} onChange={setFilters} />

          <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3">
            <p
              aria-live="polite"
              aria-atomic="true"
              className={cn(
                "text-[13.5px] text-muted-foreground transition-opacity duration-200",
                busy && "opacity-60"
              )}
            >
              <strong className="font-semibold text-highlight">{result.totalCount}</strong> model snapshot
              {result.totalCount !== 1 ? "s" : ""}
              {query && (
                <>
                  {" "}
                  for <span className="font-medium text-foreground">‘{query}’</span>
                </>
              )}
              {busy && <span className="sr-only"> Loading results</span>}
            </p>
            {filtered && resetButton}
          </div>
        </>
      )}

      <div
        aria-busy={busy ? "true" : undefined}
        className={cn("min-w-0 transition-opacity duration-200", busy && "opacity-60")}
      >
        <SnapshotGrid
          datasets={result.items}
          usedIds={usedIds}
          onDetails={openDetails}
          onSelect={onSelect}
          pendingId={pendingId}
          disabled={disabled}
          emptyAction={filtered ? resetButton : undefined}
        />
        <Pagination
          page={filters.page}
          totalPages={result.totalPages}
          onPageChange={(page) => setFilters({ page })}
        />
      </div>

      {detail && (
        <SnapshotDetailSheet
          dataset={detail}
          open={detailOpen}
          modelInputIds={modelInputIds}
          onOpenChange={setDetailOpen}
          action={
            <Button
              onClick={() => selectFromSheet(detail)}
              className="h-10 font-semibold sm:h-9"
            >
              <CheckCircle2 className="mr-1.5 size-4" aria-hidden="true" />
              Select
            </Button>
          }
        />
      )}
    </div>
  );
}
