"use client";

import { useId, useState } from "react";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FacetCheckboxList,
  ResolutionFilter,
  YearRangeFilter,
} from "@/components/repository/catalogue-sidebar";
import { countActiveFilters } from "@/lib/repository/catalogue";
import { TEMPORAL_RANGE_BOUNDS } from "@/lib/repository/data";
import { cn } from "@/lib/utils";
import type { CatalogueFacets, CatalogueFilterState } from "@/lib/repository/types";

/**
 * The toolbar above the snapshot grid, the Data Repository's search and
 * filters in one row: a search box (titles, descriptions, keywords: the
 * repository's own query) and a Filters button that opens a panel under the row
 * with the filters the repository offers for model snapshots: the tag, the
 * temporal coverage and the spatial resolution, the same controls with the same
 * facet counts. The panel is closed until asked for, and whether it is open is
 * local: the filters themselves live in the URL, through `onChange`; what is
 * narrowing the list is shown under the toolbar as chips (`ActiveFilterChips`),
 * so a closed panel hides nothing.
 */
export function SnapshotPickerFilters({
  filters,
  facets,
  onChange,
}: {
  filters: CatalogueFilterState;
  /** The facet counts of the last answer that came; they fall back to the full year range with none. */
  facets: CatalogueFacets;
  onChange: (updates: Partial<CatalogueFilterState>) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const tagsId = useId();
  const yearsId = useId();
  const resolutionId = useId();
  const activeCount = countActiveFilters(filters);
  const hasQuery = filters.searchQuery !== "";
  // A tag a stale link names stays in the list so that it can be unticked.
  const showTags = facets.tag.length > 0 || filters.tag.length > 0;

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
        <div
          className={cn(
            "grid gap-x-10 gap-y-6 rounded-xl border bg-card p-4 sm:p-5",
            showTags ? "md:grid-cols-3" : "md:grid-cols-2"
          )}
        >
          {showTags && (
            <section aria-labelledby={tagsId}>
              <h3 id={tagsId} className="mb-2 text-[13.5px] font-semibold text-foreground">
                Tags
              </h3>
              <FacetCheckboxList
                facetKey="tag"
                options={facets.tag}
                selected={filters.tag}
                onChange={(tag) => onChange({ tag })}
              />
            </section>
          )}
          <section aria-labelledby={yearsId}>
            <h3 id={yearsId} className="mb-3 text-[13.5px] font-semibold text-foreground">
              Temporal coverage
            </h3>
            <YearRangeFilter
              bounds={facets.yearBounds ?? TEMPORAL_RANGE_BOUNDS}
              start={filters.yearStart}
              end={filters.yearEnd}
              onChange={onChange}
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
