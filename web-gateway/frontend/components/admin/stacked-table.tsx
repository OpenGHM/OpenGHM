import * as React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * A table that is a table from `sm` up and a stack of cards below it, so a
 * phone never scrolls sideways. It is the same DOM in both: below `sm` the
 * table elements turn into blocks and each cell prints its `label` before its
 * value. A cell with no `label` is the row's title.
 */
export function StackedTable({ className, ...props }: React.ComponentProps<typeof Table>) {
  return <Table className={cn("max-sm:block", className)} {...props} />;
}

export function StackedHeader({ className, ...props }: React.ComponentProps<typeof TableHeader>) {
  return <TableHeader className={cn("max-sm:hidden", className)} {...props} />;
}

export function StackedBody({ className, ...props }: React.ComponentProps<typeof TableBody>) {
  return <TableBody className={cn("max-sm:block max-sm:space-y-3", className)} {...props} />;
}

export function StackedRow({ className, ...props }: React.ComponentProps<typeof TableRow>) {
  return (
    <TableRow
      className={cn(
        "max-sm:relative max-sm:block max-sm:rounded-xl max-sm:border! max-sm:bg-card max-sm:p-3",
        className
      )}
      {...props}
    />
  );
}

export function StackedCell({
  label,
  className,
  ...props
}: React.ComponentProps<typeof TableCell> & { label?: string }) {
  return (
    <TableCell
      data-label={label}
      className={cn(
        label
          ? "max-sm:flex max-sm:items-center max-sm:justify-between max-sm:gap-3 max-sm:whitespace-normal max-sm:px-0 max-sm:py-1.5 max-sm:text-right max-sm:before:shrink-0 max-sm:before:text-left max-sm:before:text-xs max-sm:before:text-muted-foreground max-sm:before:content-[attr(data-label)]"
          : "max-sm:block max-sm:whitespace-normal max-sm:px-0 max-sm:py-1",
        className
      )}
      {...props}
    />
  );
}

/*
 * The cells a list with row controls adds. Each is a column of its own from
 * `sm`; on a phone, where the row is a card, the checkbox sits in a corner of
 * the card (the row is `relative`), `TITLE_CELL` leaves room for it, and the
 * buttons run along the bottom of the card.
 */

/** The row's checkbox: the first column; the card's top-left corner. */
export const CHECK_CELL = "w-10 pr-0 max-sm:absolute max-sm:top-[1.0625rem] max-sm:left-3 max-sm:w-auto max-sm:p-0";

/** The row's action buttons: the last column, as wide as they are (`w-px` and
 *  no wrapping), so the title keeps the room; the bottom of the card on a phone. */
export const ACTIONS_CELL =
  "w-px pr-3 pl-0 text-right whitespace-nowrap max-sm:mt-2 max-sm:block max-sm:w-full max-sm:border-t max-sm:px-0 max-sm:pt-3 max-sm:pb-0";

/** The row's title, which may wrap so a long one does not widen the table, with
 *  the corner left free for the checkbox. */
export const TITLE_CELL = "min-w-0 whitespace-normal max-sm:pl-8";
