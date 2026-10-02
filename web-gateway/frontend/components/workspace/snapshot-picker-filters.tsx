"use client";

import { useId, useState } from "react";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResolutionFilter, YearRangeFilter } from "@/components/repository/catalogue-sidebar";
import { TEMPORAL_RANGE_BOUNDS } from "@/lib/repository/data";
import { cn } from "@/lib/utils";
import type { FilterState } from "@/lib/repository/types";

/** What the Filters badge counts: the year range and the resolution range, each once. The search box is not a filter group. */
export function countPickerFilters(filters: FilterState): number {
  let n = 0;
  if (filters.temporalCoverageStart !== null || filters.temporalCoverageEnd !== null) n += 1;
  if (filters.spatialResMin !== null || filters.spatialResMax !== null) n += 1;
  return n;
}

/** Anything narrowing the list, the search included. */
export function hasPickerFilters(filters: FilterState): boolean {
  return countPickerFilters(filters) > 0 || filters.searchQuery.trim() !== "";
}

/** The filters a Reset puts back: everything but the sort, which the picker does not offer. */
export const CLEARED_PICKER_FILTERS: Partial<FilterState> = {
  searchQuery: "",
  temporalCoverageStart: null,
  temporalCoverageEnd: null,
  spatialResMin: null,
  spatialResMax: null,
};

/**
 * The row above the snapshot list: a search box, and a Filters button that
 * opens a panel of the same year-range and resolution controls the Data
 * Repository's sidebar has, in columns, under the row. The panel is closed
 * until asked for, and whether it is open is local: the filters themselves
 * live in the URL, through `onChange`.
 */
export function SnapshotPickerFilters({
  filters,
  onChange,
}: {
  filters: FilterState;
  onChange: (updates: Partial<FilterState>) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const yearsId = useId();
  const resolutionId = useId();
  const activeCount = countPickerFilters(filters);
  const hasQuery = filters.searchQuery !== "";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2.5 sm:flex-nowrap">
        <div className="flex h-11 min-w-0 flex-1 basis-full items-center gap-2.5 rounded-xl border bg-card px-3.5 transition-shadow focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 motion-reduce:transition-none sm:basis-0">
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <input
            type="search"
            aria-label="Search model snapshots"
            placeholder="Search model snapshots…"
            value={filters.searchQuery}
            onChange={(e) => onChange({ searchQuery: e.target.value })}
            className="h-full min-w-0 flex-1 bg-transparent text-[14.5px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none"
          />
          {hasQuery && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onChange({ searchQuery: "" })}
              className="-mr-2 inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          )}
        </div>

        <Button
          type="button"
          variant="outline"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="h-11 w-full shrink-0 justify-between gap-2 rounded-xl bg-card hover:bg-muted hover:text-foreground sm:w-auto"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal aria-hidden="true" />
            Filters
            {activeCount > 0 && (
              <Badge className="bg-highlight/10 text-highlight">
                <span aria-hidden="true">{activeCount}</span>
                <span className="sr-only">{activeCount} active</span>
              </Badge>
            )}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn("motion-safe:transition-transform", open && "rotate-180")}
          />
        </Button>
      </div>

      {/* `hidden` on a wrapper of its own: a display class on the card would beat it. */}
      <div id={panelId} hidden={!open}>
        <div className="grid gap-x-10 gap-y-6 rounded-xl border bg-card p-4 sm:p-5 md:grid-cols-2">
          <section aria-labelledby={yearsId}>
            <h3 id={yearsId} className="mb-3 text-[13.5px] font-semibold text-foreground">
              Temporal coverage
            </h3>
            <YearRangeFilter
              bounds={TEMPORAL_RANGE_BOUNDS}
              start={filters.temporalCoverageStart}
              end={filters.temporalCoverageEnd}
              onChange={({ yearStart, yearEnd }) =>
                onChange({ temporalCoverageStart: yearStart, temporalCoverageEnd: yearEnd })
              }
            />
          </section>
          <section aria-labelledby={resolutionId}>
            <h3 id={resolutionId} className="mb-3 text-[13.5px] font-semibold text-foreground">
              Spatial resolution
            </h3>
            <ResolutionFilter
              min={filters.spatialResMin}
              max={filters.spatialResMax}
              onChange={onChange}
            />
          </section>
        </div>
      </div>
    </div>
  );
}
