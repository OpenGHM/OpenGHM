"use client";

import { Fragment } from "react";
import { Eye, EyeOff, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** One thing to do with a row: a link that leaves the page (`href`) or something to do (`onSelect`). */
export interface RowAction {
  key: string;
  /** The button's tooltip; the buttons are icons. */
  label: string;
  /** What assistive technology hears. It names the row: "Hide <title>". */
  name: string;
  icon: LucideIcon;
  /** An icon-only link to the live page, opened in a new tab. */
  href?: string;
  onSelect?: () => void;
  /** Shown in the destructive colour. It only asks: it opens the confirmation dialog. */
  destructive?: boolean;
  disabled?: boolean;
  /**
   * What the button is for, so each role looks its own: `visible` and `hidden`
   * colour the visibility toggle by the state it shows now, `pinned` fills the
   * pin button. Without one it is neutral.
   */
  tone?: "visible" | "hidden" | "pinned";
  /** A toggle that is on right now (a pinned item). Sets `aria-pressed`. */
  pressed?: boolean;
}

const TONE_CLASS = {
  visible: "text-success hover:bg-success/10 hover:text-success dark:hover:bg-success/20",
  hidden: "text-muted-foreground",
  pinned: "bg-primary text-primary-foreground hover:bg-primary/85 hover:text-primary-foreground",
} as const;

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
          "size-10 shrink-0 sm:size-8",
          action.tone ? TONE_CLASS[action.tone] : "text-muted-foreground",
          action.destructive && "text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20"
        );
        return (
          <Fragment key={action.key}>
            {action.destructive && <span aria-hidden="true" data-separator className="mx-1 h-5 w-px shrink-0 bg-border" />}
          <Tooltip>
            <TooltipTrigger asChild>
              {action.href ? (
                <Button asChild variant="ghost" size="icon" className={look}>
                  <a href={action.href} target="_blank" rel="noopener noreferrer" aria-label={action.name}>
                    <Icon aria-hidden="true" className={action.pressed ? "fill-current" : undefined} />
                  </a>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={look}
                  aria-label={action.name}
                  aria-pressed={action.pressed}
                  data-tone={action.tone}
                  disabled={action.disabled}
                  onClick={action.onSelect}
                >
                  <Icon aria-hidden="true" className={action.pressed ? "fill-current" : undefined} />
                </Button>
              )}
            </TooltipTrigger>
            <TooltipContent>{action.label}</TooltipContent>
          </Tooltip>
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * The visibility toggle of a row. Icon and colour show what the item is now
 * (Eye in the success colour: visible; EyeOff, muted: hidden); the tooltip
 * and name say what a click does.
 */
export function visibilityAction(
  item: { title: string; state: "draft" | "published" },
  busy: boolean,
  setState: (state: "draft" | "published") => void
): RowAction {
  const visible = item.state === "published";
  return {
    key: "visibility",
    label: visible ? "Visible — click to hide" : "Hidden — click to show",
    name: `${visible ? "Hide" : "Show"} ${item.title}`,
    icon: visible ? Eye : EyeOff,
    tone: visible ? "visible" : "hidden",
    disabled: busy,
    onSelect: () => setState(visible ? "draft" : "published"),
  };
}
