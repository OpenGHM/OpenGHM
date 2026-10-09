"use client";

import { cn } from "@/lib/utils";
import type { CatalogueFilterState, CatalogueSortOption, CatalogueView } from "@/lib/repository/types";

const SORT_OPTIONS: { value: CatalogueSortOption; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "newest", label: "Newest" },
  { value: "title-az", label: "Title A–Z" },
  { value: "title-za", label: "Title Z–A" },
  { value: "coverage-start", label: "Coverage start" },
];

const VIEWS: { value: CatalogueView; label: string }[] = [
  { value: "list", label: "List" },
  { value: "grid", label: "Grid" },
];

/**
 * The sort and the list / grid switch, at the right of the results bar (the
 * search box is in the page's band: `CatalogueSearch`). The sort is a filter;
 * the view is only how the same results are laid out.
 */
export function CatalogueToolbar({
  filters,
  onChange,
}: {
  filters: CatalogueFilterState;
  onChange: (updates: Partial<CatalogueFilterState>) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="flex items-center gap-1.5 rounded-[11px] bg-muted pr-1 pl-3 transition-shadow focus-within:ring-[3px] focus-within:ring-ring/50 motion-reduce:transition-none">
        <label htmlFor="catalogue-sort" className="text-[12.5px] text-muted-foreground">
          Sort
        </label>
        <select
          id="catalogue-sort"
          value={filters.sortBy}
          onChange={(e) => onChange({ sortBy: e.target.value as CatalogueSortOption })}
          className="h-10 cursor-pointer bg-transparent px-1.5 text-[13.5px] font-semibold text-foreground outline-none"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div role="group" aria-label="View" className="flex gap-0.5 rounded-[11px] bg-muted p-[3px]">
        {VIEWS.map((v) => {
          const on = filters.view === v.value;
          return (
            <button
              key={v.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ view: v.value })}
              className={cn(
                "h-10 min-w-12 rounded-lg px-3 text-[13px] font-semibold outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none sm:h-[34px]",
                on ? "bg-hero text-white" : "text-foreground/80 hover:bg-card"
              )}
            >
              {v.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
