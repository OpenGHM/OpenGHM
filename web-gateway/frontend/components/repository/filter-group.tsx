"use client";

import { useId, useState } from "react";
import { Minus, Plus } from "lucide-react";

/**
 * A collapsible group of filters, separated from the next by a rule: a header
 * button with a + (closed) or – (open) at its right edge, and the controls
 * below it. The button's name is the group's title; `aria-expanded` and
 * `aria-controls` say whether, and what, it opens. A group that holds a
 * selection opens on first render, so the choice is not hidden.
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
    <div className="border-b border-border px-4 pb-1 last:border-b-0 sm:px-[18px]">
      <button
        type="button"
        id={buttonId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="-mx-1 flex min-h-11 w-[calc(100%+0.5rem)] items-center justify-between gap-2 rounded-md px-1 text-left text-[13.5px] font-semibold text-foreground outline-none hover:text-foreground/70 focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
