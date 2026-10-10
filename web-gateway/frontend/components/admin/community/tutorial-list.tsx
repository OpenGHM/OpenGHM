"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { EyeOff, ExternalLink, GripVertical, Trash2, Upload } from "lucide-react";
import { TableHead, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/admin/admin-states";
import {
  CHECK_CELL,
  ACTIONS_CELL,
  StackedBody,
  StackedCell,
  StackedHeader,
  StackedRow,
  StackedTable,
} from "@/components/admin/stacked-table";
import { DeleteButton, DeleteItemsDialog, StateButtons, useContentActions } from "@/components/admin/community/content-actions";
import { StatePill } from "@/components/admin/community/form-bits";
import { RowActions } from "@/components/admin/community/row-actions";
import { RowCheckbox, SelectAllCheckbox, SelectionBar } from "@/components/admin/community/selection";
import { TimeStamp } from "@/components/common/time-stamp";
import { reorderTutorials } from "@/lib/community/admin-actions";
import { moveItem } from "@/lib/community/admin-format";
import { isEmptyDoc } from "@/lib/community/admin-richtext";
import { TUTORIAL_KINDS, TUTORIAL_LEVELS } from "@/lib/community/admin-forms";
import { cn } from "@/lib/utils";
import type { Tutorial } from "@/lib/community/types";

const kindLabel = (kind: Tutorial["kind"]) => TUTORIAL_KINDS.find((k) => k.value === kind)?.label ?? kind;
const levelLabel = (level: Tutorial["level"]) => TUTORIAL_LEVELS.find((l) => l.value === level)?.label ?? level;

/** The handle's column, and the card's top-right corner in the corner on a phone. */
const GRIP_CELL = "w-10 px-0 max-sm:absolute max-sm:top-1.5 max-sm:right-1.5 max-sm:w-auto max-sm:p-0";

const CSS_ESCAPE = (value: string) => value.replace(/["\\]/g, "\\$&");

const INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    "To reorder, focus the drag handle and press Space to pick the tutorial up. Use the up and down arrow keys to move it, then press Space again to drop it, or Escape to cancel.",
};

/**
 * The tutorials in the order they appear on the Community page. Each row has
 * a grip to drag it by (or to focus and move with the keyboard: Space, arrows,
 * Space) and a checkbox and action buttons like the other lists. A move shows at
 * once and is sent to the backend as the whole new order (`reorder`); if the
 * backend refuses, the list goes back and says so. dnd-kit announces the
 * pick-up, each step and the drop to a screen reader, in these words.
 */
export function TutorialList({ tutorials }: { tutorials: Tutorial[] }) {
  const router = useRouter();
  const [order, setOrder] = useState(tutorials);
  const [seen, setSeen] = useState(tutorials);
  const [pending, setPending] = useState(false);
  const { selection, selectedItems, busy, setState, deleting, askDelete, closeDelete } = useContentActions("tutorials", order);

  // After a keyboard drop the rows have been re-inserted and the focus with them lost: give it back to the handle.
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    if (refocus.current === null) return;
    document.querySelector<HTMLElement>(`[data-handle-for="${CSS_ESCAPE(refocus.current)}"]`)?.focus();
    if (!pending) refocus.current = null;
  }, [order, pending]);

  const sensors = useSensors(
    // A few pixels first, so a click on the handle is not a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // A refreshed page brings the stored order; show it.
  if (seen !== tutorials) {
    setSeen(tutorials);
    setOrder(tutorials);
  }

  const move = async (from: number, to: number) => {
    if (pending) return;
    const before = order;
    const next = moveItem(order, from, to);
    setOrder(next);
    setPending(true);
    let failure: string | null = null;
    try {
      const result = await reorderTutorials(next.map((t) => t.id));
      if (!result.ok) {
        failure =
          result.reason === "session_expired"
            ? "Your session has expired. Sign in again to change the order."
            : result.reason === "not_found"
              ? "A tutorial in the list no longer exists. Reload the page."
              : result.message;
      }
    } catch {
      failure = "Couldn't change the order. Nothing was changed; try again.";
    }
    setPending(false);
    if (failure) {
      setOrder(before);
      toast.error(failure);
      return;
    }
    router.refresh();
  };

  const onDragEnd = ({ active, over, activatorEvent }: DragEndEvent) => {
    if (activatorEvent instanceof KeyboardEvent) refocus.current = String(active.id);
    if (!over || active.id === over.id) return;
    const from = order.findIndex((t) => t.id === active.id);
    const to = order.findIndex((t) => t.id === over.id);
    if (from >= 0 && to >= 0) void move(from, to);
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const at = order.findIndex((t) => t.id === active.id);
      return `Picked up ${order[at]?.title}. It is at position ${at + 1} of ${order.length}.`;
    },
    onDragOver: ({ active, over }) => {
      const at = order.findIndex((t) => t.id === (over ?? active).id);
      return `${order.find((t) => t.id === active.id)?.title} is now over position ${at + 1} of ${order.length}.`;
    },
    onDragEnd: ({ active, over }) => {
      const title = order.find((t) => t.id === active.id)?.title;
      const at = order.findIndex((t) => t.id === (over ?? active).id);
      return over && over.id !== active.id
        ? `${title} dropped at position ${at + 1} of ${order.length}.`
        : `${title} dropped. It stays at position ${at + 1} of ${order.length}.`;
    },
    onDragCancel: ({ active }) => {
      const at = order.findIndex((t) => t.id === active.id);
      return `Reordering cancelled. ${order[at]?.title} stays at position ${at + 1} of ${order.length}.`;
    },
  };

  if (order.length === 0) {
    return (
      <EmptyState title="No tutorials yet.">
        Add the first one with New tutorial. It stays a draft, off the site, until you publish it.
      </EmptyState>
    );
  }

  return (
    <>
      <SelectionBar selection={selection} label="tutorials" layout="table">
        <StateButtons
          count={selectedItems.length}
          busy={busy}
          onPublish={() => void setState(selectedItems, "published")}
          onDraft={() => void setState(selectedItems, "draft")}
        />
        <DeleteButton busy={busy} onClick={() => askDelete(selectedItems)} />
      </SelectionBar>
      <DndContext
        // A fixed id, so the ids dnd-kit puts in the markup agree between the server and the browser.
        id="tutorial-order"
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        accessibility={{ announcements, screenReaderInstructions: INSTRUCTIONS }}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={order.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <StackedTable>
            <StackedHeader>
              <TableRow>
                <TableHead className={CHECK_CELL}>
                  <SelectAllCheckbox selection={selection} label="tutorials" />
                </TableHead>
                <TableHead className={GRIP_CELL}>
                  <span className="sr-only">Reorder</span>
                </TableHead>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="sm:max-[1359px]:hidden">Updated</TableHead>
                <TableHead className={ACTIONS_CELL}>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </StackedHeader>
            <StackedBody>
              {order.map((t, i) => (
                <TutorialRow
                  key={t.id}
                  tutorial={t}
                  position={i + 1}
                  selected={selection.has(t.id)}
                  selection={selection}
                  frozen={pending}
                  busy={busy}
                  onSetState={(state) => void setState([t], state)}
                  onDelete={() => askDelete([t])}
                />
              ))}
            </StackedBody>
          </StackedTable>
        </SortableContext>
      </DndContext>
      <DeleteItemsDialog noun="tutorials" targets={deleting} onClose={closeDelete} onDeleted={selection.drop} />
    </>
  );
}

function TutorialRow({
  tutorial: t,
  position,
  selected,
  selection,
  frozen,
  busy,
  onSetState,
  onDelete,
}: {
  tutorial: Tutorial;
  position: number;
  selected: boolean;
  selection: ReturnType<typeof useContentActions>["selection"];
  /** A reorder is on its way to the backend: no dragging until it answers. */
  frozen: boolean;
  busy: boolean;
  onSetState: (state: "published" | "draft") => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: t.id,
    disabled: frozen,
  });
  const href = `/admin/community/tutorials/${encodeURIComponent(t.id)}`;

  return (
    <StackedRow
      ref={setNodeRef}
      data-state={selected ? "selected" : undefined}
      data-dragging={isDragging ? "true" : undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // On a phone the card leads with the title, not the position.
      className={cn("max-sm:flex max-sm:flex-col", isDragging && "relative z-10 bg-secondary shadow-lift outline-2 -outline-offset-2 outline-primary/50 max-sm:outline-solid")}
    >
      <StackedCell className={CHECK_CELL}>
        <RowCheckbox selection={selection} id={t.id} title={t.title} />
      </StackedCell>
      <StackedCell className={GRIP_CELL}>
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          data-handle-for={t.id}
          aria-label={`Drag to reorder ${t.title}`}
          className={cn(
            "grid size-10 touch-none place-items-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-disabled:pointer-events-none aria-disabled:opacity-50 sm:size-8",
            isDragging ? "cursor-grabbing" : "cursor-grab"
          )}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
      </StackedCell>
      <StackedCell label="Position" className="w-12 font-mono text-xs text-muted-foreground">
        {String(position).padStart(2, "0")}
      </StackedCell>
      <StackedCell className="min-w-0 whitespace-normal max-sm:order-first max-sm:pr-12 max-sm:pl-8">
        <Link
          href={href}
          className="font-medium text-foreground underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {t.title}
        </Link>
        <p className="font-mono text-xs break-all text-muted-foreground">/{t.slug}</p>
      </StackedCell>
      <StackedCell label="Kind" className="text-sm">
        {kindLabel(t.kind)} · {levelLabel(t.level)}
        {t.minutes !== null && ` · ${t.minutes} min`}
      </StackedCell>
      <StackedCell label="State">
        <StatePill state={t.state} />
      </StackedCell>
      <StackedCell label="Updated" className="text-xs text-muted-foreground sm:max-[1359px]:hidden">
        <TimeStamp value={t.updated_at} format="relative" />
      </StackedCell>
      <StackedCell className={ACTIONS_CELL}>
        <RowActions
          actions={[
            // As in the editor, a tutorial has a page of its own only when it has page text.
            ...(t.state === "published" && !isEmptyDoc(t.body)
              ? [{ key: "view", label: "View on site", name: `View ${t.title} on site`, icon: ExternalLink, href: `/community/tutorials/${encodeURIComponent(t.slug)}` }]
              : []),
            t.state === "published"
              ? { key: "draft", label: "Move to draft", name: `Move to draft: ${t.title}`, icon: EyeOff, disabled: busy, onSelect: () => onSetState("draft") }
              : { key: "publish", label: "Publish", name: `Publish ${t.title}`, icon: Upload, disabled: busy, onSelect: () => onSetState("published") },
            { key: "delete", label: "Delete", name: `Delete ${t.title}`, icon: Trash2, destructive: true, onSelect: onDelete },
          ]}
        />
      </StackedCell>
    </StackedRow>
  );
}
