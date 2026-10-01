"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A collapsible group of filters: a header button with a chevron, and the
 * controls below it. The button carries `aria-expanded`/`aria-controls`, so it
 * works from the keyboard and a screen reader says whether the group is open.
 * `activeCount` shows how many values are selected inside, so a collapsed
 * group still tells you it narrows the list.
 */
export function FilterGroup({
  title,
  children,
  defaultOpen = true,
  activeCount = 0,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  activeCount?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const baseId = useId();
  const buttonId = `${baseId}-button`;
  const panelId = `${baseId}-panel`;

  return (
    <div className="border-b border-border py-1 last:border-b-0">
      <button
        type="button"
        id={buttonId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-1 text-left text-sm font-semibold text-foreground transition-colors outline-none hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-9"
      >
        <span className="flex min-w-0 items-center gap-2">
          {title}
          {activeCount > 0 && (
            <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-medium text-primary">
              <span className="sr-only">{activeCount} selected</span>
              <span aria-hidden="true">{activeCount}</span>
            </span>
          )}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-muted-foreground motion-safe:transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      <div
        id={panelId}
        role="group"
        aria-labelledby={buttonId}
        hidden={!open}
        className="px-1 pt-1 pb-3"
      >
        {children}
      </div>
    </div>
  );
}
