"use client";

import Link from "next/link";
import { ExternalLink, Trash2 } from "lucide-react";
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
  TITLE_CELL,
} from "@/components/admin/stacked-table";
import { DeleteButton, DeleteItemsDialog, StateButtons, useContentActions } from "@/components/admin/community/content-actions";
import { PinnedBadge, StatePill, WorkshopStatusPill } from "@/components/admin/community/form-bits";
import { RowActions, visibilityAction, type RowAction } from "@/components/admin/community/row-actions";
import { RowCheckbox, SelectAllCheckbox, SelectionBar } from "@/components/admin/community/selection";
import { usePinToggle } from "@/components/admin/home/use-pin-toggle";
import { TimeStamp } from "@/components/common/time-stamp";
import type { Workshop } from "@/lib/community/types";

/** A workshop's dates as the list prints them: the first day, and the last when there is one. */
function DateRange({ workshop }: { workshop: Workshop }) {
  return (
    <span className="whitespace-nowrap">
      <TimeStamp value={workshop.date} format="date" />
      {workshop.end_date && workshop.end_date !== workshop.date && (
        <>
          {" – "}
          <TimeStamp value={workshop.end_date} format="date" />
        </>
      )}
    </span>
  );
}

/**
 * Every workshop, newest first as the backend sends them, each a link to its
 * editor. A checkbox on each row selects it for Show, Hide and
 * Delete, and the buttons at the end of a row do the same for that row alone,
 * plus pinning it to the home page. `pinned` is the ids pinned now, or null
 * when they could not be read.
 */
export function WorkshopList({ workshops, pinned = null }: { workshops: Workshop[]; pinned?: readonly string[] | null }) {
  const { selection, selectedItems, busy, setState, deleting, askDelete, closeDelete } = useContentActions("workshops", workshops);
  const pins = usePinToggle("workshop", pinned);

  if (workshops.length === 0) {
    return (
      <EmptyState title="No workshops yet.">
        Add the first one with New workshop. It stays hidden from the site until you make it visible.
      </EmptyState>
    );
  }
  return (
    <>
      <SelectionBar selection={selection} label="workshops" layout="table">
        <StateButtons
          count={selectedItems.length}
          busy={busy}
          onShow={() => void setState(selectedItems, "published")}
          onHide={() => void setState(selectedItems, "draft")}
        />
        <DeleteButton busy={busy} onClick={() => askDelete(selectedItems)} />
      </SelectionBar>
      <StackedTable>
        <StackedHeader>
          <TableRow>
            <TableHead className={CHECK_CELL}>
              <SelectAllCheckbox selection={selection} label="workshops" />
            </TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>When</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className={ACTIONS_CELL}>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </StackedHeader>
        <StackedBody>
          {workshops.map((w) => {
            const href = `/admin/community/workshops/${encodeURIComponent(w.id)}`;
            return (
              <StackedRow key={w.id} data-state={selection.has(w.id) ? "selected" : undefined}>
                <StackedCell className={CHECK_CELL}>
                  <RowCheckbox selection={selection} id={w.id} title={w.title} />
                </StackedCell>
                <StackedCell className={TITLE_CELL}>
                  <Link
                    href={href}
                    className="font-medium text-foreground underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {w.title}
                  </Link>
                  <p className="font-mono text-xs break-all text-muted-foreground">/{w.slug}</p>
                  {pinned?.includes(w.id) && <PinnedBadge />}
                </StackedCell>
                <StackedCell label="Date" className="text-sm">
                  <DateRange workshop={w} />
                </StackedCell>
                <StackedCell label="When">
                  <WorkshopStatusPill status={w.status} />
                </StackedCell>
                <StackedCell label="State">
                  <StatePill state={w.state} />
                </StackedCell>
                <StackedCell label="Updated" className="text-xs text-muted-foreground">
                  <TimeStamp value={w.updated_at} format="relative" />
                </StackedCell>
                <StackedCell className={ACTIONS_CELL}>
                  <RowActions
                    actions={[
                      ...(w.state === "published"
                        ? [{ key: "view", label: "View on site", name: `View ${w.title} on site`, icon: ExternalLink, href: `/community/workshops/${encodeURIComponent(w.slug)}` }]
                        : []),
                      visibilityAction(w, busy, (state) => void setState([w], state)),
                      pins.action({ id: w.id, title: w.title, published: w.state === "published" }),
                      { key: "delete", label: "Delete", name: `Delete ${w.title}`, icon: Trash2, destructive: true, onSelect: () => askDelete([w]) },
                    ].filter((a): a is RowAction => a !== null)}
                  />
                </StackedCell>
              </StackedRow>
            );
          })}
        </StackedBody>
      </StackedTable>
      <DeleteItemsDialog noun="workshops" targets={deleting} onClose={closeDelete} onDeleted={selection.drop} />
    </>
  );
}
