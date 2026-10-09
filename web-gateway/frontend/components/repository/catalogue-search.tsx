"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CatalogueSearchState {
  query: string;
  onQueryChange: (query: string) => void;
}

const CatalogueSearchContext = createContext<CatalogueSearchState | null>(null);

/**
 * Hands the catalogue's search query to the search box. The box sits in the
 * page's navy band, outside the results column that owns the filters, so the
 * query travels through here rather than through props.
 */
export function CatalogueSearchProvider({
  query,
  onQueryChange,
  children,
}: CatalogueSearchState & { children: ReactNode }) {
  return (
    <CatalogueSearchContext.Provider value={{ query, onQueryChange }}>
      {children}
    </CatalogueSearchContext.Provider>
  );
}

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
 * The search box of the Data Repository's band: press `/` to jump to it,
 * Escape to leave it. The query is a filter and applies as it is typed; the
 * Search button (and Enter) only moves on to the results.
 */
export function CatalogueSearch() {
  const state = useContext(CatalogueSearchContext);
  if (!state) throw new Error("CatalogueSearch must be rendered inside a CatalogueSearchProvider");
  const { query, onQueryChange } = state;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (isTextTarget(e.target)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const results = document.getElementById("catalogue-results");
        results?.scrollIntoView?.({ block: "start" });
        results?.focus({ preventScroll: true });
      }}
      className="flex h-[60px] w-full max-w-[920px] items-center gap-3 rounded-2xl bg-white pr-2 pl-[18px] shadow-float transition-shadow focus-within:ring-[3px] focus-within:ring-hero-eyebrow motion-reduce:transition-none"
    >
      <Search aria-hidden="true" className="size-[18px] shrink-0 text-foreground" />
      <input
        ref={inputRef}
        id="catalogue-search"
        type="search"
        aria-label="Search the repository"
        placeholder="Search titles, descriptions, keywords…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur();
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none"
      />
      {query !== "" ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onQueryChange("");
            inputRef.current?.focus();
          }}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      ) : (
        <kbd
          aria-hidden="true"
          className="hidden shrink-0 rounded-md border border-border px-[7px] py-[3px] font-mono text-[11px] text-muted-foreground sm:inline-block"
        >
          /
        </kbd>
      )}
      <Button
        type="submit"
        className="h-11 rounded-[11px] bg-hero px-4 text-sm font-semibold text-white hover:bg-hero/85 sm:px-5"
      >
        Search
      </Button>
    </form>
  );
}
