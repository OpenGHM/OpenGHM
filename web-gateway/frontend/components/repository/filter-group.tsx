"use client";

import { useId, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A collapsible group of filters: a header button with a + (closed) or – (open)
 * at its right edge, and the controls below it. The button's name is the
 * group's title; `aria-expanded` and `aria-controls` say whether, and what, it
 * opens. A group that holds a selection opens on first render, so the choice
 * is not hidden.
 *
 * A group that opens by default is a section of the panel, headed by a small
 * uppercase label; one that starts closed is a row of the list below, set off
 * by a rule and titled in bold, as in the design.
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
  const [open, setOpen] = useState(defaultOpen || activeCount > 0);
  const baseId = useId();
  const buttonId = `${baseId}-button`;
  const panelId = `${baseId}-panel`;
  const Icon = open ? Minus : Plus;

  return (
    <div className={cn("px-5", defaultOpen ? "pb-3" : "border-t border-border/70")}>
      <button
        type="button"
        id={buttonId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "-mx-1 flex w-[calc(100%+0.5rem)] items-center justify-between gap-2 rounded-md px-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          defaultOpen
            ? "min-h-11 text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase hover:text-foreground"
            : "min-h-12 text-sm font-semibold text-foreground hover:text-foreground/70"
        )}
      >
        <span className="min-w-0">{title}</span>
        <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      <div id={panelId} role="group" aria-labelledby={buttonId} hidden={!open} className="pt-0.5 pb-3">
        {children}
      </div>
    </div>
  );
}
