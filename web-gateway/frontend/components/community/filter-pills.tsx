"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface FilterPillOption<T extends string> {
  id: T;
  label: string;
  /** A small mark before the label: the level's bars, a type's colour. */
  mark?: ReactNode;
}

/**
 * A row of toggle buttons on a white track, one of them on (navy fill): the
 * level filter of Tutorials and the type filter of Publications. Plain
 * buttons with `aria-pressed`; each is 40 px tall and the row wraps on a phone.
 */
export function FilterPills<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: FilterPillOption<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1 rounded-xl bg-card p-1">
      {options.map((option) => {
        const on = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.id)}
            className={cn(
              "flex min-h-10 items-center gap-[7px] rounded-[9px] px-3 text-[13px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              on ? "bg-hero text-white" : "text-foreground/80 hover:bg-muted",
            )}
          >
            {option.mark}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
