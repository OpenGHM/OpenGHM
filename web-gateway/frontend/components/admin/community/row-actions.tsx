"use client";

import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** One thing to do with a row: a link that leaves the page (`href`) or something to do (`onSelect`). */
export interface RowAction {
  key: string;
  /** The button's tooltip; the buttons are icons. */
  label: string;
  /** What assistive technology hears. It names the row and contains `label`: "Publish <title>". */
  name: string;
  icon: LucideIcon;
  /** An icon-only link to the live page, opened in a new tab. */
  href?: string;
  onSelect?: () => void;
  /** Shown in the destructive colour. It only asks: it opens the confirmation dialog. */
  destructive?: boolean;
  disabled?: boolean;
}

/**
 * The buttons at the end of a row, in the order given: icons, each with its
 * label as a tooltip and the row in its accessible name. A destructive one is
 * in the destructive colour; a link opens the live page in a new tab.
 */
export function RowActions({ actions, className }: { actions: RowAction[]; className?: string }) {
  return (
    <div className={cn("flex items-center justify-end gap-1 whitespace-nowrap", className)}>
      {actions.map((action) => {
        const Icon = action.icon;
        const look = cn(
          "size-10 shrink-0 text-muted-foreground sm:size-8",
          action.destructive && "text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
        );
        return (
          <Tooltip key={action.key}>
            <TooltipTrigger asChild>
              {action.href ? (
                <Button asChild variant="ghost" size="icon" className={look}>
                  <a href={action.href} target="_blank" rel="noopener noreferrer" aria-label={action.name}>
                    <Icon aria-hidden="true" />
                  </a>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={look}
                  aria-label={action.name}
                  disabled={action.disabled}
                  onClick={action.onSelect}
                >
                  <Icon aria-hidden="true" />
                </Button>
              )}
            </TooltipTrigger>
            <TooltipContent>{action.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
