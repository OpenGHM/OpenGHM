"use client";

import Link from "next/link";
import { EyeOff, ExternalLink, Trash2, Upload } from "lucide-react";
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
import { StatePill, WorkshopStatusPill } from "@/components/admin/community/form-bits";
import { RowActions } from "@/components/admin/community/row-actions";
import { RowCheckbox, SelectAllCheckbox, SelectionBar } from "@/components/admin/community/selection";
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
 * editor. A checkbox on each row selects it for Publish, Move to draft and
 * Delete, and the buttons at the end of a row do the same for that row alone.
 */
export function WorkshopList({ workshops }: { workshops: Workshop[] }) {
  const { selection, selectedItems, busy, setState, deleting, askDelete, closeDelete } = useContentActions("workshops", workshops);

  if (workshops.length === 0) {
    return (
      <EmptyState title="No workshops yet.">
        Add the first one with New workshop. It stays a draft, off the site, until you publish it.
      </EmptyState>
    );
  }
  return (
    <>
      <SelectionBar selection={selection} label="workshops" layout="table">
        <StateButtons
          count={selectedItems.length}
          busy={busy}
          onPublish={() => void setState(selectedItems, "published")}
          onDraft={() => void setState(selectedItems, "draft")}
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
            <TableHead className="sm:max-[1359px]:hidden">Updated</TableHead>
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
                <StackedCell label="Updated" className="text-xs text-muted-foreground sm:max-[1359px]:hidden">
                  <TimeStamp value={w.updated_at} format="relative" />
                </StackedCell>
                <StackedCell className={ACTIONS_CELL}>
                  <RowActions
                    actions={[
                      ...(w.state === "published"
                        ? [
                            { key: "view", label: "View on site", name: `View ${w.title} on site`, icon: ExternalLink, href: `/community/workshops/${encodeURIComponent(w.slug)}` },
                            { key: "draft", label: "Move to draft", name: `Move to draft: ${w.title}`, icon: EyeOff, disabled: busy, onSelect: () => void setState([w], "draft") },
                          ]
                        : [{ key: "publish", label: "Publish", name: `Publish ${w.title}`, icon: Upload, disabled: busy, onSelect: () => void setState([w], "published") }]),
                      { key: "delete", label: "Delete", name: `Delete ${w.title}`, icon: Trash2, destructive: true, onSelect: () => askDelete([w]) },
                    ]}
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
