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
import type { Dataset, FilterState, RepositoryListResponse } from "@/lib/repository/types";

const EMPTY_RESULT: RepositoryListResponse = {
  items: [],
  totalCount: 0,
  totalPages: 1,
  page: 1,
};

/**
 * Step 1 of the new-simulation wizard: the same search/filter/sort/table
 * the Data Repository uses (`DatasetTable`, `useUrlSyncedFilters`), in
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
}: {
  initialFilters: FilterState;
  initialData: RepositoryListResponse;
  initialModelInputIds: Set<string> | null;
  onSelect: (dataset: Dataset) => void;
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
      className="font-semibold"
    >
      <CheckCircle2 className="mr-1.5 size-4" />
      Select
    </Button>
  );

  return (
    <div className="mx-auto flex max-w-[1280px] gap-8 px-10 py-10">
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
        <div className="mb-6 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {isPending ? (
              <span className="inline-block h-4 w-24 animate-pulse rounded bg-muted" />
            ) : (
              <>
                {result.totalCount} snapshot{result.totalCount !== 1 ? "s" : ""} available
              </>
            )}
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div>
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
