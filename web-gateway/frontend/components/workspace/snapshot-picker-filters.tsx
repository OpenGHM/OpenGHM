"use client";

import { useId, useState } from "react";
import { ChevronDown, ListFilter, Search, SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CatalogueFilterBody } from "@/components/repository/catalogue-filter-body";
import {
  clearedFilters,
  countActiveFilters,
  countMoreFilters,
  pickerFilterGroups,
  SNAPSHOT_PICKER_FIXED_FILTERS,
  visibleFilterGroups,
} from "@/lib/repository/catalogue";
import { SnapshotPickerMoreFilters } from "./snapshot-picker-more-filters";
import { cn } from "@/lib/utils";
import type { CatalogueFacets, CatalogueFilterState } from "@/lib/repository/types";

/**
 * The toolbar above the snapshot grid, the Data Repository's search and
 * filters in one row: a search box (titles, descriptions, keywords: the
 * repository's own query) and a Filters button that opens a panel under the row
 * with the repository's filter groups flagged `picker` in
 * `CATALOGUE_FILTER_GROUPS` (the same controls with the same facet counts),
 * less what the picker fixes (`SNAPSHOT_PICKER_FIXED_FILTERS`: the type). The
 * groups are not listed here: the definition says which there are. The panel
 * stays compact; its "More filters" button opens a dialog
 * (`SnapshotPickerMoreFilters`) with every group of the definition, so no
 * filter is out of reach. The panel is closed until asked for, and whether it
 * (or the dialog) is open is local: the filters themselves live in the URL,
 * through `onChange`; what is narrowing the list is shown under the toolbar as
 * chips (`ActiveFilterChips`), so a closed panel hides nothing.
 */
export function SnapshotPickerFilters({
  filters,
  facets,
  onChange,
  resultCount = null,
}: {
  filters: CatalogueFilterState;
  /** The facet counts of the last answer that came; they fall back to the full year range with none. */
  facets: CatalogueFacets;
  onChange: (updates: Partial<CatalogueFilterState>) => void;
  /** How many snapshots the filters find now, for the dialog's "Show N snapshots"; `null` when unknown. */
  resultCount?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const panelId = useId();
  const headingId = useId();
  const activeCount = countActiveFilters(filters, SNAPSHOT_PICKER_FIXED_FILTERS);
  const hasQuery = filters.searchQuery !== "";
  const groups = pickerFilterGroups(facets, filters);
  const moreCount = countMoreFilters(filters);
  // Nothing to open when the compact panel already has every group.
  const hasMore = visibleFilterGroups(facets, filters, SNAPSHOT_PICKER_FIXED_FILTERS).length > groups.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl border bg-card px-3.5 transition-shadow focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 motion-reduce:transition-none">
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <input
            type="search"
            aria-label="Search model snapshots"
            placeholder="Search snapshots…"
            value={filters.searchQuery}
            onChange={(e) => onChange({ searchQuery: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") e.currentTarget.blur();
            }}
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
          className="h-11 shrink-0 gap-2 rounded-xl bg-card px-3.5 hover:bg-muted hover:text-foreground"
        >
          <SlidersHorizontal aria-hidden="true" />
          Filters
          {activeCount > 0 && (
            <Badge className="bg-highlight/10 text-highlight">
              <span aria-hidden="true">{activeCount}</span>
              <span className="sr-only">{activeCount} active</span>
            </Badge>
          )}
          <ChevronDown
            aria-hidden="true"
            className={cn("motion-safe:transition-transform", open && "rotate-180")}
          />
        </Button>
      </div>

      {/* `hidden` on a wrapper of its own: a display class on the card would beat it. */}
      <div id={panelId} hidden={!open}>
        <div className="rounded-xl border bg-card p-4 sm:p-5">
          <div className={cn("grid gap-x-10 gap-y-6", groups.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2")}>
            {groups.map((group) => {
              const id = `${headingId}-${group.key}`;
              return (
                <section key={group.key} aria-labelledby={id}>
                  <h3
                    id={id}
                    className={cn(
                      "text-[13.5px] font-semibold text-foreground",
                      group.kind === "facet" ? "mb-2" : "mb-3"
                    )}
                  >
                    {group.title}
                  </h3>
                  <CatalogueFilterBody
                    group={group}
                    filters={filters}
                    facets={facets}
                    onChange={onChange}
                  />
                </section>
              );
            })}
          </div>

          {hasMore && (
            <div className="mt-5 flex border-t pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setMoreOpen(true)}
                className="h-10 gap-2 rounded-lg bg-card hover:bg-muted hover:text-foreground sm:h-9"
              >
                <ListFilter aria-hidden="true" />
                More filters
                {moreCount > 0 && (
                  <Badge className="bg-highlight/10 text-highlight">
                    <span aria-hidden="true">{moreCount}</span>
                    <span className="sr-only">{moreCount} active</span>
                  </Badge>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>

      <SnapshotPickerMoreFilters
        open={moreOpen}
        onOpenChange={setMoreOpen}
        filters={filters}
        facets={facets}
        onChange={onChange}
        onReset={() => onChange(resetUpdates(filters))}
        resultCount={resultCount}
      />
    </div>
  );
}

/** What the dialog's Reset sets: every filter off, the search kept. */
function resetUpdates(filters: CatalogueFilterState): CatalogueFilterState {
  return { ...clearedFilters(filters), searchQuery: filters.searchQuery };
}
