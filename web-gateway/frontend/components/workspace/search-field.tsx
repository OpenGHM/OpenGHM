"use client";

import { useRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A search box drawn like the Data Repository's: a rounded field with a
 * magnifier and, once something is typed, a Clear button. Escape clears it.
 * The Workspace lists use it to filter the rows they have already loaded as you
 * type; nothing is sent anywhere.
 */
export function SearchField({
  value,
  onChange,
  label,
  placeholder = "Search by name…",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The accessible name: what is searched. */
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <div
      className={cn(
        "flex h-10.5 min-w-0 items-center gap-2.5 rounded-xl border bg-card px-3 transition-shadow focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 motion-reduce:transition-none",
        className
      )}
    >
      <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <input
        ref={ref}
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value !== "") {
            event.preventDefault();
            onChange("");
          }
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value !== "" && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange("");
            ref.current?.focus();
          }}
          className="-mr-2 inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}

/** The rows whose name contains what was typed, in any case. An empty box matches every row. */
export function matchesQuery(name: string, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  return wanted === "" || name.toLowerCase().includes(wanted);
}
