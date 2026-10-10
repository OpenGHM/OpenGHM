"use client";

import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** One thing to do with a row: a link that leaves the page (`href`) or something to do (`onSelect`). */
export interface RowAction {
  key: string;
  /** What the button says. A link has no text: this is its tooltip. */
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
 * The buttons at the end of a row, in the order given. A link is an icon with a
 * tooltip; the rest are small labelled buttons, a destructive one in the
 * destructive colour. On a phone the labelled buttons share the card's width.
 */
export function RowActions({ actions, className }: { actions: RowAction[]; className?: string }) {
  return (
    <div className={cn("flex items-center justify-end gap-1.5 whitespace-nowrap max-sm:w-full", className)}>
      {actions.map((action) => {
        const Icon = action.icon;
        if (action.href) {
          return (
            <Tooltip key={action.key}>
              <TooltipTrigger asChild>
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="size-10 shrink-0 text-muted-foreground sm:size-8"
                >
                  <a href={action.href} target="_blank" rel="noopener noreferrer" aria-label={action.name}>
                    <Icon aria-hidden="true" />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{action.label}</TooltipContent>
            </Tooltip>
          );
        }
        return (
          <Button
            key={action.key}
            type="button"
            variant={action.destructive ? "ghost" : "outline"}
            size="sm"
            className={cn(
              "min-h-10 sm:min-h-8 max-sm:flex-1",
              action.destructive && "text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
            )}
            aria-label={action.name}
            disabled={action.disabled}
            onClick={action.onSelect}
          >
            <Icon aria-hidden="true" />
            {action.label}
          </Button>
        );
      })}
    </div>
  );
}
