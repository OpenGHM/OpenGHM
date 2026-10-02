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
}: {
  filters: CatalogueFilterState;
  facets: CatalogueFacets;
  onChange: (updates: Partial<CatalogueFilterState>) => void;
  onClearAll: () => void;
}) {
  const chips = activeFilterChips(filters, facets);
  if (chips.length === 0) return null;

  return (
    <ul aria-label="Active filters" className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <li key={chip.id}>
          <button
            type="button"
            aria-label={`Remove filter: ${chip.label}`}
            onClick={() => onChange(chip.remove)}
            className="inline-flex h-10 max-w-full items-center gap-1.5 rounded-full border border-transparent bg-slate-100 pr-2.5 pl-3 text-xs font-medium text-foreground outline-none transition-colors hover:bg-slate-200 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none sm:h-8"
          >
            <span className="truncate">{chip.label}</span>
            <X aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </li>
      ))}
      <li>
        <button
          type="button"
          onClick={onClearAll}
          className="inline-flex h-10 items-center rounded-md px-2 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-8"
        >
          Clear all
        </button>
      </li>
    </ul>
  );
}
