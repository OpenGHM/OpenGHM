"use client";

import { useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  countActiveFilters,
  facetGroupOptions,
  groupActiveCount,
  hasActiveFilters,
  visibleFilterGroups,
} from "@/lib/repository/catalogue";
import type { CatalogueFacets, CatalogueFilterState } from "@/lib/repository/types";
import { CatalogueFilterBody } from "./catalogue-filter-body";
import { COLLAPSED_OPTION_COUNT } from "./catalogue-filter-controls";
import { FilterGroup } from "./filter-group";

/**
 * The Data Repository's filter sidebar: every group of `CATALOGUE_FILTER_GROUPS`
 * as a collapsible `FilterGroup`, in the card beside the results. The groups and
 * their bodies come from the shared definition; this only frames them.
 */
export function CatalogueSidebar({
  filters,
  facets,
  onChange,
  onClearAll,
}: {
  filters: CatalogueFilterState;
  facets: CatalogueFacets;
  onChange: (updates: Partial<CatalogueFilterState>) => void;
  onClearAll: () => void;
}) {
  // Below lg the panel is folded behind a "Filters" button; from lg it is always open.
  const [panelOpen, setPanelOpen] = useState(false);
  const activeCount = countActiveFilters(filters);
  const anyActive = hasActiveFilters(filters);

  return (
    <aside aria-label="Filters" className="w-full lg:w-[260px] lg:shrink-0">
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          variant="outline"
          aria-expanded={panelOpen}
          aria-controls="catalogue-filters-panel"
          onClick={() => setPanelOpen((o) => !o)}
          className="h-11 w-full justify-between rounded-xl bg-card hover:bg-muted hover:text-foreground lg:hidden"
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
            className={cn("motion-safe:transition-transform", panelOpen && "rotate-180")}
          />
        </Button>

        <Card
          id="catalogue-filters-panel"
          className={cn(
            "gap-0 overflow-hidden rounded-2xl border py-0 shadow-none lg:flex",
            panelOpen ? "flex" : "hidden"
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 sm:px-[18px]">
            <h2 className="text-[15px] font-semibold text-foreground">Filters</h2>
            {anyActive && (
              <button
                type="button"
                onClick={onClearAll}
                className="inline-flex min-h-10 items-center rounded-md px-1 text-[13px] text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-8"
              >
                Reset
              </button>
            )}
          </div>

          <div>
            {visibleFilterGroups(facets, filters).map((group) => (
              <FilterGroup
                key={group.key}
                title={group.title}
                defaultOpen={
                  group.defaultOpen === "when-short"
                    ? group.kind === "facet" &&
                      facetGroupOptions(group.key, facets).length <=
                        (group.shortAtMost ?? COLLAPSED_OPTION_COUNT)
                    : group.defaultOpen
                }
                activeCount={groupActiveCount(group, filters)}
              >
                <CatalogueFilterBody
                  group={group}
                  filters={filters}
                  facets={facets}
                  onChange={onChange}
                />
              </FilterGroup>
            ))}
          </div>
        </Card>
      </div>
    </aside>
  );
}
