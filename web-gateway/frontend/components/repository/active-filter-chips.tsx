import { X } from "lucide-react";
import { activeFilterChips } from "@/lib/repository/catalogue";
import type { CatalogueFacets, CatalogueFilterState } from "@/lib/repository/types";

/**
 * What is narrowing the list, one chip per selected value. A chip is a button:
 * pressing it takes that one filter off. Renders nothing when no filter is on.
 */
export function ActiveFilterChips({
  filters,
  facets,
  onChange,
  onClearAll,
  fixed,
}: {
  filters: CatalogueFilterState;
  facets: CatalogueFacets;
  onChange: (updates: Partial<CatalogueFilterState>) => void;
  onClearAll: () => void;
  /** Filters the context fixes (the picker's type): never shown as chips. */
  fixed?: Partial<CatalogueFilterState>;
}) {
  const chips = activeFilterChips(filters, facets, fixed);
  if (chips.length === 0) return null;

  return (
    <ul aria-label="Active filters" className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => (
        <li key={chip.id}>
          <button
            type="button"
            aria-label={`Remove filter: ${chip.label}`}
            onClick={() => onChange(chip.remove)}
            className="inline-flex h-10 max-w-full items-center gap-1.5 rounded-full bg-hero pr-2 pl-3 text-[12.5px] font-medium text-white outline-none transition-colors hover:bg-hero/85 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none sm:h-8"
          >
            <span className="truncate">{chip.label}</span>
            <span
              aria-hidden="true"
              className="grid size-4 shrink-0 place-items-center rounded-full bg-white/15"
            >
              <X className="size-3" />
            </span>
          </button>
        </li>
      ))}
      <li>
        <button
          type="button"
          onClick={onClearAll}
          className="inline-flex h-10 items-center rounded-md px-2 text-[13px] font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-8"
        >
          Clear all
        </button>
      </li>
    </ul>
  );
}
