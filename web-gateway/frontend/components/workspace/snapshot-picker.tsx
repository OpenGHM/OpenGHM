"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatasetTable } from "@/components/repository/dataset-table";
import { RepositorySidebar } from "@/components/repository/repository-sidebar";
import { Pagination } from "@/components/repository/pagination";
import { SnapshotDetailPanel } from "./snapshot-detail-panel";
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

/**
 * The Start screen's model snapshot picker (step 1 of the draft wizard): the
 * same search/filter/sort/table the Data Repository uses (`DatasetTable`,
 * `useUrlSyncedFilters`), in
 * "pick" mode — a `Select` action per row and a detail panel in place of
 * navigation (spec.md's table: browse gets the detail page, the picker
 * gets a panel and a commit control). Selecting hands the chosen dataset
 * to `onSelect`; nothing is created here.
 */
export function SnapshotPicker({
  initialFilters,
  initialData,
  initialModelInputIds,
  onSelect,
  embedded = false,
}: {
  initialFilters: FilterState;
  initialData: RepositoryListResponse;
  initialModelInputIds: Set<string> | null;
  onSelect: (dataset: Dataset) => void;
  /** Inside a page that already sets the width and the gutters (the Start
   *  screen): drop the picker's own. */
  embedded?: boolean;
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

  // A refetch keeps the table and the count on screen; they dim only if the
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

  const [openId, setOpenId] = useState<string | null>(null);
  const openDataset = result.items.find((d) => d.id === openId) ?? null;

  const handleNameClick = useCallback((dataset: Dataset) => {
    setOpenId((prev) => (prev === dataset.id ? null : dataset.id));
  }, []);

  const selectButton = (dataset: Dataset) => (
    <Button
      size="sm"
      onClick={() => onSelect(dataset)}
      className="h-10 w-full font-semibold sm:h-8 sm:w-auto"
    >
      <CheckCircle2 className="mr-1.5 size-4" />
      Select
    </Button>
  );

  return (
    <div
      className={cn(
        "flex flex-col gap-6 lg:flex-row lg:gap-8",
        embedded ? "" : "mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-10 lg:py-10"
      )}
    >
      <RepositorySidebar
        filters={filters}
        onFiltersChange={setFilters}
        onClearAll={() =>
          setFilters({
            searchQuery: "",
            temporalCoverageStart: null,
            temporalCoverageEnd: null,
            spatialResMin: null,
            spatialResMax: null,
          })
        }
      />

      <div className="min-w-0 flex-1">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p
            aria-live="polite"
            className={cn("text-sm text-muted-foreground transition-opacity duration-200", busy && "opacity-60")}
          >
            {result.totalCount} model snapshot{result.totalCount !== 1 ? "s" : ""} available
            {busy && <span className="sr-only"> Loading results</span>}
          </p>
        </div>

        <div className={cn("grid gap-6", openDataset && "lg:grid-cols-[1fr_360px]")}>
          <div
            aria-busy={busy ? "true" : undefined}
            className={cn("min-w-0 transition-opacity duration-200", busy && "opacity-60")}
          >
            <DatasetTable
              datasets={result.items}
              modelInputIds={modelInputIds}
              selectedId={openId}
              onNameClick={handleNameClick}
              renderAction={selectButton}
            />
            <Pagination
              page={filters.page}
              totalPages={result.totalPages}
              onPageChange={(page) => setFilters({ page })}
            />
          </div>

          {openDataset && (
            <SnapshotDetailPanel
              dataset={openDataset}
              modelInputIds={modelInputIds}
              onClose={() => setOpenId(null)}
              action={selectButton(openDataset)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
