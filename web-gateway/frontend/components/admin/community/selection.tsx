"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { selectionState } from "@/lib/community/admin-bulk";

/**
 * Which rows of a list are ticked. Only an id that is still listed counts, so
 * a refresh that removed a row drops it from the selection by itself, and the
 * rows a failed action left behind stay ticked.
 */
export function useSelection(ids: readonly string[]) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const selected = ids.filter((id) => picked.has(id));
  const has = (id: string) => picked.has(id);

  const toggle = useCallback((id: string, on: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const setAll = (on: boolean) => setPicked(on ? new Set(ids) : new Set());
  const clear = useCallback(() => setPicked(new Set()), []);
  /** Un-tick these, the ones an action has dealt with. */
  const drop = useCallback((done: readonly string[]) => {
    setPicked((prev) => {
      const next = new Set(prev);
      done.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  return { selected, has, toggle, setAll, clear, drop, state: selectionState(ids.length, selected.length) };
}

export type Selection = ReturnType<typeof useSelection>;

/** The select-all checkbox of a table header or a toolbar. Ticking it from a
 *  part-selected state selects every row; ticking it when all are selected clears. */
export function SelectAllCheckbox({
  selection,
  label,
  disabled,
  className,
}: {
  selection: Selection;
  /** What is selected, for its name: "workshops" gives "Select all workshops". */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Checkbox
      aria-label={`Select all ${label}`}
      checked={selection.state}
      disabled={disabled}
      className={className}
      onCheckedChange={(value) => selection.setAll(value === true)}
    />
  );
}

/** A row's checkbox, named by the row's title. */
export function RowCheckbox({
  selection,
  id,
  title,
  disabled,
  className,
}: {
  selection: Selection;
  id: string;
  title: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Checkbox
      aria-label={`Select ${title}`}
      checked={selection.has(id)}
      disabled={disabled}
      className={className}
      onCheckedChange={(value) => selection.toggle(id, value === true)}
    />
  );
}

/**
 * The bar above a list. With nothing selected it is only the select-all row,
 * and only where the list has no header to carry one: always for a grid, and
 * on a phone for a table (its header is hidden there). With something selected
 * it becomes the count and what can be done: the caller's buttons as
 * `children`, then Clear selection.
 */
export function SelectionBar({
  selection,
  label,
  layout,
  children,
}: {
  selection: Selection;
  /** The plural of what the rows are, for the names ("workshops"). */
  label: string;
  layout: "table" | "grid";
  /** The action buttons, shown while something is selected. */
  children?: React.ReactNode;
}) {
  const count = selection.selected.length;
  // A table's header already has select-all from `sm` up.
  const onlyOnPhone = layout === "table";
  if (count === 0 && !(layout === "grid" || onlyOnPhone)) return null;

  return (
    <div
      role="region"
      aria-label={`Selected ${label}`}
      className={cn(
        "mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3 py-1.5",
        count > 0 ? "bg-secondary" : onlyOnPhone ? "sm:hidden" : ""
      )}
    >
      <div className="flex min-h-10 items-center gap-2.5 text-sm font-medium text-foreground sm:min-h-9">
        <SelectAllCheckbox selection={selection} label={label} className={onlyOnPhone ? "sm:hidden" : undefined} />
        <span aria-live="polite">{count > 0 ? `${count} selected` : "Select all"}</span>
      </div>
      {count > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">{children}</div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto min-h-10 text-muted-foreground sm:min-h-8"
            onClick={selection.clear}
          >
            Clear selection
          </Button>
        </>
      )}
    </div>
  );
}
