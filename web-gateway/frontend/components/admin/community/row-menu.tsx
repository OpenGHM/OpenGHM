"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** One entry of a row's menu: a link (`href`) or something to do (`onSelect`). */
export interface RowAction {
  key: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  /** A link that leaves the page: it opens in a new tab. */
  external?: boolean;
  onSelect?: () => void;
  /** Shown in the destructive colour, after a separator. */
  destructive?: boolean;
  disabled?: boolean;
}

/**
 * The "⋯" at the end of a row, and the menu it opens. `title` names the row
 * for the button ("Actions for <title>"). A destructive action goes last,
 * set apart, and only asks: it opens the confirmation dialog, it does not act.
 */
export function RowMenu({ title, actions, className }: { title: string; actions: RowAction[]; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("size-10 text-muted-foreground sm:size-8", className)}
          aria-label={`Actions for ${title}`}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {actions.map((action, i) => {
          const Icon = action.icon;
          const separated = action.destructive && i > 0;
          const body = (
            <>
              <Icon aria-hidden="true" />
              {action.label}
            </>
          );
          return (
            <span key={action.key} className="contents">
              {separated && <DropdownMenuSeparator />}
              {action.href ? (
                <DropdownMenuItem asChild disabled={action.disabled} className="min-h-10 sm:min-h-0">
                  {action.external ? (
                    <a href={action.href} target="_blank" rel="noopener noreferrer">
                      {body}
                    </a>
                  ) : (
                    <Link href={action.href}>{body}</Link>
                  )}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  variant={action.destructive ? "destructive" : "default"}
                  disabled={action.disabled}
                  className="min-h-10 sm:min-h-0"
                  onSelect={action.onSelect}
                >
                  {body}
                </DropdownMenuItem>
              )}
            </span>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
