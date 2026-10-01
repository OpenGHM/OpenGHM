"use client";

import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
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

/** A key press whose target takes typed text: the `/` shortcut leaves it alone. */
function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "reset", "range"].includes(target.type);
  }
  return false;
}

/**
 * The row above the results: search (press `/` to jump to it, Escape to leave
 * it), the sort, and the list / grid switch. The search and the sort are
 * filters; the view is only how the same results are laid out.
 */
export function CatalogueToolbar({
  filters,
  onChange,
}: {
  filters: CatalogueFilterState;
  onChange: (updates: Partial<CatalogueFilterState>) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (isTextTarget(e.target)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const hasQuery = filters.searchQuery !== "";

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="flex h-11 min-w-0 flex-1 basis-[320px] items-center gap-2.5 rounded-xl border bg-card px-3.5 transition-shadow focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 motion-reduce:transition-none">
        <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={searchRef}
          id="catalogue-search"
          type="search"
          aria-label="Search the repository"
          placeholder="Search titles, descriptions, keywords…"
          value={filters.searchQuery}
          onChange={(e) => onChange({ searchQuery: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-[14.5px] text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none"
        />
        {hasQuery ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              onChange({ searchQuery: "" });
              searchRef.current?.focus();
            }}
            className="-mr-2 inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        ) : (
          <kbd
            aria-hidden="true"
            className="hidden shrink-0 rounded-[5px] border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground sm:inline-block"
          >
            /
          </kbd>
        )}
      </div>

      <div className="flex h-11 items-center gap-2 rounded-xl border bg-card pr-1.5 pl-3.5 transition-shadow focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 motion-reduce:transition-none">
        <label htmlFor="catalogue-sort" className="text-[13px] text-muted-foreground">
          Sort
        </label>
        <select
          id="catalogue-sort"
          value={filters.sortBy}
          onChange={(e) => onChange({ sortBy: e.target.value as CatalogueSortOption })}
          className="h-10 cursor-pointer bg-transparent px-1.5 text-sm font-medium text-foreground outline-none"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div role="group" aria-label="View" className="flex h-11 gap-0.5 rounded-xl bg-muted p-0.5">
        {VIEWS.map((v) => {
          const on = filters.view === v.value;
          return (
            <button
              key={v.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ view: v.value })}
              className={cn(
                "h-10 min-w-12 rounded-[10px] px-3 text-[13px] font-medium text-foreground outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none",
                on ? "bg-card shadow-sm" : "hover:bg-card/60"
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
