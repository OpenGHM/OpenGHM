"use client";

import { useEffect, useRef } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type ScreenReaderInstructions,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, PinOff, TriangleAlert } from "lucide-react";
import { RowActions } from "@/components/admin/community/row-actions";
import { TimeStamp } from "@/components/common/time-stamp";
import { moveItem } from "@/lib/community/admin-format";
import { PIN_REASON_LABEL, type PinRow } from "@/lib/home/admin-forms";
import { KIND_LABEL, pinKey } from "@/lib/home/format";
import { cn } from "@/lib/utils";

const CSS_ESCAPE = (value: string) => value.replace(/["\\]/g, "\\$&");

const INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    "To reorder, focus the drag handle and press Space to pick the item up. Use the up and down arrow keys to move it, then press Space again to drop it, or Escape to cancel.",
};

const nameOf = (row: PinRow) => row.title ?? `${KIND_LABEL[row.kind]} ${row.id}`;

/**
 * The pinned items in the order they show on the home page, first first. Each
 * row has a grip to drag it by (or to focus and move with the keyboard: Space,
 * arrows, Space) and a button to unpin it. A pin whose item is gone, or is no
 * longer published, is marked and stays until it is removed; the home page
 * skips it. Nothing here is saved until the form is: the order is the form's.
 */
export function PinnedList({
  pins,
  count,
  onChange,
}: {
  pins: PinRow[];
  /** How many cards the home page has room for: pins past it do not show. */
  count: number;
  onChange: (next: PinRow[]) => void;
}) {
  const sensors = useSensors(
    // A few pixels first, so a click on the handle is not a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // After a keyboard drop the rows have been re-inserted and the focus with them lost: give it back to the handle.
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    if (refocus.current === null) return;
    document.querySelector<HTMLElement>(`[data-handle-for="${CSS_ESCAPE(refocus.current)}"]`)?.focus();
    refocus.current = null;
  }, [pins]);

  const indexOf = (key: string | number) => pins.findIndex((p) => pinKey(p) === key);

  const onDragEnd = ({ active, over, activatorEvent }: DragEndEvent) => {
    if (activatorEvent instanceof KeyboardEvent) refocus.current = String(active.id);
    if (!over || active.id === over.id) return;
    const from = indexOf(active.id);
    const to = indexOf(over.id);
    if (from >= 0 && to >= 0) onChange(moveItem(pins, from, to));
  };

  const title = (key: string | number) => {
    const row = pins[indexOf(key)];
    return row ? nameOf(row) : "";
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${title(active.id)}. It is at position ${indexOf(active.id) + 1} of ${pins.length}.`,
    onDragOver: ({ active, over }) =>
      `${title(active.id)} is now over position ${indexOf((over ?? active).id) + 1} of ${pins.length}.`,
    onDragEnd: ({ active, over }) =>
      over && over.id !== active.id
        ? `${title(active.id)} dropped at position ${indexOf(over.id) + 1} of ${pins.length}.`
        : `${title(active.id)} dropped. It stays at position ${indexOf(active.id) + 1} of ${pins.length}.`,
    onDragCancel: ({ active }) =>
      `Reordering cancelled. ${title(active.id)} stays at position ${indexOf(active.id) + 1} of ${pins.length}.`,
  };

  if (pins.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Nothing is pinned. The home page shows the newest items. Add a pin below to keep one on it.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {pins.length > count && (
        <p role="status" className="text-xs text-muted-foreground">
          The home page has room for {count}, so only the first {count} {count === 1 ? "pin shows" : "pins show"}.
        </p>
      )}
      <DndContext
        // A fixed id, so the ids dnd-kit puts in the markup agree between the server and the browser.
        id="pin-order"
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        accessibility={{ announcements, screenReaderInstructions: INSTRUCTIONS }}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={pins.map(pinKey)} strategy={verticalListSortingStrategy}>
          <ol aria-label="Pinned items" className="space-y-2">
            {pins.map((row, i) => (
              <PinnedRow
                key={pinKey(row)}
                row={row}
                position={i + 1}
                beyond={i >= count}
                onRemove={() => onChange(pins.filter((p) => pinKey(p) !== pinKey(row)))}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function PinnedRow({
  row,
  position,
  beyond,
  onRemove,
}: {
  row: PinRow;
  position: number;
  beyond: boolean;
  onRemove: () => void;
}) {
  const key = pinKey(row);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: key });
  const name = nameOf(row);

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      data-dragging={isDragging ? "true" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-xl border border-border bg-card py-1.5 pr-1.5 pl-1.5",
        row.reason && "border-destructive/30 bg-destructive/5",
        beyond && !row.reason && "opacity-60",
        isDragging && "relative z-10 bg-secondary shadow-lift outline-2 -outline-offset-2 outline-primary/50"
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        data-handle-for={key}
        aria-label={`Drag to reorder ${name}`}
        className={cn(
          "grid size-10 shrink-0 touch-none place-items-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:size-8",
          isDragging ? "cursor-grabbing" : "cursor-grab"
        )}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>
      <span className="w-6 shrink-0 font-mono text-xs text-muted-foreground">{String(position).padStart(2, "0")}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{KIND_LABEL[row.kind]}</span>
          {row.date && <TimeStamp value={row.date} format="date" />}
          {row.reason && (
            <span className="inline-flex items-center gap-1 font-medium text-destructive">
              <TriangleAlert className="size-3.5" aria-hidden="true" />
              {PIN_REASON_LABEL[row.reason]}: not shown. Remove it.
            </span>
          )}
        </p>
      </div>
      <RowActions
        actions={[{ key: "unpin", label: "Unpin", name: `Unpin ${name}`, icon: PinOff, destructive: Boolean(row.reason), onSelect: onRemove }]}
      />
    </li>
  );
}
