"use client";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CatalogueFilterSection } from "@/components/repository/catalogue-filter-body";
import {
  countActiveFilters,
  SNAPSHOT_PICKER_FIXED_FILTERS,
  visibleFilterGroups,
} from "@/lib/repository/catalogue";
import type { CatalogueFacets, CatalogueFilterState } from "@/lib/repository/types";

/**
 * The picker's "More filters" dialog: every filter group of the Data
 * Repository's definition (`visibleFilterGroups`, less what the picker fixes),
 * in the repository's order and in the sidebar's collapsible frame, so a filter
 * added to `CATALOGUE_FILTER_GROUPS` is here without a second edit. It is a
 * complete view, not the remainder of the compact panel: the groups the panel
 * has are in it too, open. Changes go through the same `onChange` as the panel's
 * and so into the same URL. It is the app's sheet (a Radix Dialog): focus is
 * trapped, Escape closes it, and it fills a phone's screen.
 */
export function SnapshotPickerMoreFilters({
  open,
  onOpenChange,
  filters,
  facets,
  onChange,
  onReset,
  resultCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: CatalogueFilterState;
  facets: CatalogueFacets;
  onChange: (updates: Partial<CatalogueFilterState>) => void;
  /** Clears every filter the picker does not fix; the search stays. */
  onReset: () => void;
  /** How many snapshots the current filters find; `null` when that is not known. */
  resultCount: number | null;
}) {
  const groups = visibleFilterGroups(facets, filters, SNAPSHOT_PICKER_FIXED_FILTERS);
  const anyActive = countActiveFilters(filters, SNAPSHOT_PICKER_FIXED_FILTERS) > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="text-[15px]">Filters</SheetTitle>
          <SheetDescription className="sr-only">
            Narrow the model snapshots by any of the repository&rsquo;s filters. Changes apply as you make them.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="p-0">
          {groups.map((group) => (
            <CatalogueFilterSection
              key={group.key}
              group={group}
              filters={filters}
              facets={facets}
              onChange={onChange}
            />
          ))}
        </SheetBody>

        <SheetFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={!anyActive}
            onClick={onReset}
            className="h-10 px-3 text-primary hover:text-primary sm:h-9"
          >
            Reset
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)} className="h-10 font-semibold sm:h-9">
            {resultCount === null
              ? "Done"
              : `Show ${resultCount} snapshot${resultCount === 1 ? "" : "s"}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
