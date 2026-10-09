"use client";

import { useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  countActiveFilters,
  hasActiveFilters,
  visibleFilterGroups,
} from "@/lib/repository/catalogue";
import type { CatalogueFacets, CatalogueFilterState } from "@/lib/repository/types";
import { CatalogueFilterSection } from "./catalogue-filter-body";

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
    <aside aria-label="Filters" className="w-full lg:w-[268px] lg:shrink-0">
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          variant="ghost"
          aria-expanded={panelOpen}
          aria-controls="catalogue-filters-panel"
          onClick={() => setPanelOpen((o) => !o)}
          className="h-12 w-full justify-between rounded-2xl bg-card px-4 font-semibold shadow-raised hover:bg-card hover:text-foreground dark:hover:bg-card lg:hidden"
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
            "gap-0 overflow-hidden rounded-card border-0 py-0 shadow-raised lg:flex",
            panelOpen ? "flex" : "hidden"
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-5 pb-3.5">
            <h2 className="text-[17px] font-bold tracking-[-0.02em] text-foreground">Filters</h2>
            {anyActive && (
              <button
                type="button"
                onClick={onClearAll}
                className="inline-flex min-h-10 items-center rounded-full bg-muted px-2.5 text-[12.5px] font-medium text-foreground/80 outline-none hover:bg-border focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-8"
              >
                Reset
              </button>
            )}
          </div>

          <div>
            {visibleFilterGroups(facets, filters).map((group) => (
              <CatalogueFilterSection
                key={group.key}
                group={group}
                filters={filters}
                facets={facets}
                onChange={onChange}
              />
            ))}
          </div>
        </Card>
      </div>
    </aside>
  );
}
