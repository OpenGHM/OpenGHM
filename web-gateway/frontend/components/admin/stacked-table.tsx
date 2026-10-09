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
        "max-sm:block max-sm:rounded-xl max-sm:border! max-sm:bg-card max-sm:p-3",
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
