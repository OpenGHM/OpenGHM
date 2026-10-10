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
import { StatePill } from "@/components/admin/community/form-bits";
import { RowActions, type RowAction } from "@/components/admin/community/row-actions";
import { RowCheckbox, SelectAllCheckbox, SelectionBar } from "@/components/admin/community/selection";
import { usePinToggle } from "@/components/admin/home/use-pin-toggle";
import { TimeStamp } from "@/components/common/time-stamp";
import { isEmptyDoc } from "@/lib/community/admin-richtext";
import type { NewsPost } from "@/lib/community/types";
import { NEWS_TAGS, TAG_CLASS } from "@/lib/home/format";
import { cn } from "@/lib/utils";

/**
 * Every news post, newest date first as the backend sends them, each a link
 * to its editor. A checkbox on each row selects it for Publish, Move to draft
 * and Delete, and the buttons at the end of a row do the same for that row
 * alone, plus pinning it to the home page. `pinned` is the ids pinned now, or
 * null when they could not be read.
 */
export function NewsList({ posts, pinned }: { posts: NewsPost[]; pinned: readonly string[] | null }) {
  const { selection, selectedItems, busy, setState, deleting, askDelete, closeDelete } = useContentActions("news", posts);
  const pins = usePinToggle("news", pinned);

  if (posts.length === 0) {
    return (
      <EmptyState title="No news posts yet.">
        Add the first one with New post. It stays a draft, off the site, until you publish it.
      </EmptyState>
    );
  }
  return (
    <>
      <SelectionBar selection={selection} label="posts" layout="table">
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
              <SelectAllCheckbox selection={selection} label="posts" />
            </TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Tag</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className={ACTIONS_CELL}>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </StackedHeader>
        <StackedBody>
          {posts.map((p) => {
            const href = `/admin/home/news/${encodeURIComponent(p.id)}`;
            const isPinned = pinned?.includes(p.id) ?? false;
            const actions: (RowAction | null)[] = [
              // A post has a page of its own only when it has page text.
              p.state === "published" && !isEmptyDoc(p.body)
                ? { key: "view", label: "View on site", name: `View ${p.title} on site`, icon: ExternalLink, href: `/news/${encodeURIComponent(p.slug)}` }
                : null,
              pins.action({ id: p.id, title: p.title, published: p.state === "published" }),
              p.state === "published"
                ? { key: "draft", label: "Move to draft", name: `Move to draft: ${p.title}`, icon: EyeOff, disabled: busy, onSelect: () => void setState([p], "draft") }
                : { key: "publish", label: "Publish", name: `Publish ${p.title}`, icon: Upload, disabled: busy, onSelect: () => void setState([p], "published") },
              { key: "delete", label: "Delete", name: `Delete ${p.title}`, icon: Trash2, destructive: true, onSelect: () => askDelete([p]) },
            ];
            return (
              <StackedRow key={p.id} data-state={selection.has(p.id) ? "selected" : undefined}>
                <StackedCell className={CHECK_CELL}>
                  <RowCheckbox selection={selection} id={p.id} title={p.title} />
                </StackedCell>
                <StackedCell className={TITLE_CELL}>
                  <Link
                    href={href}
                    className="font-medium text-foreground underline-offset-4 outline-none hover:text-primary hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {p.title}
                  </Link>
                  <p className="font-mono text-xs break-all text-muted-foreground">/{p.slug}</p>
                  {isPinned && <p className="mt-1 text-xs font-medium text-primary">Pinned to the home page</p>}
                </StackedCell>
                <StackedCell label="Tag">
                  <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold", TAG_CLASS[p.tag])}>
                    {NEWS_TAGS.find((t) => t.value === p.tag)?.label ?? p.tag}
                  </span>
                </StackedCell>
                <StackedCell label="Date" className="text-sm whitespace-nowrap">
                  <TimeStamp value={p.date} format="date" />
                </StackedCell>
                <StackedCell label="State">
                  <StatePill state={p.state} />
                </StackedCell>
                <StackedCell label="Updated" className="text-xs text-muted-foreground">
                  <TimeStamp value={p.updated_at} format="relative" />
                </StackedCell>
                <StackedCell className={ACTIONS_CELL}>
                  <RowActions actions={actions.filter((a): a is RowAction => a !== null)} />
                </StackedCell>
              </StackedRow>
            );
          })}
        </StackedBody>
      </StackedTable>
      <DeleteItemsDialog noun="news" targets={deleting} onClose={closeDelete} onDeleted={selection.drop} />
    </>
  );
}
