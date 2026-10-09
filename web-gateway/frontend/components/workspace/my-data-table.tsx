"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { TimeStamp } from "@/components/common/time-stamp";
import { clampClass } from "@/components/common/clamped-name";
import { ListToolbar } from "@/components/workspace/list-toolbar";
import { MyDataKindTabs, pushOnPlainClick } from "@/components/workspace/my-data-kind-tabs";
import { SearchField, matchesQuery } from "@/components/workspace/search-field";
import { VisibilityBadge } from "@/components/workspace/visibility-badge";
import { coverageLine, detailHref, kindLabel } from "@/lib/repository/catalogue-format";
import type { MineItem } from "@/lib/repository/types";
import { cn } from "@/lib/utils";
import {
  KIND_TABS,
  countByKind,
  filterByKind,
  kindFromParam,
  kindHref,
} from "@/lib/workspace/my-data";

/** The columns from `sm` up (Published joins at `md`). Written whole because Tailwind reads source text. */
const COLUMNS = "sm:grid-cols-[minmax(0,1fr)_8.5rem_5.5rem] md:grid-cols-[minmax(0,1fr)_8.5rem_5.5rem_7rem]";

/** An id as a row shows it: enough to tell two apart, the rest one click away. */
function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

/** The row key: a snapshot and a model input could share an id. */
function rowKey(item: MineItem): string {
  return `${item.kind}:${item.id}`;
}

/** "Model Snapshot" or "Model Input" as a dot in the kind's hue and a word. No box: the row is the thing. */
function KindLabel({ kind }: { kind: MineItem["kind"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-foreground">
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full", kind === "snapshot" ? "bg-primary" : "bg-compute")}
      />
      {kindLabel(kind)}
    </span>
  );
}

/**
 * The caller's snapshots and model inputs: the kind filter and a search box,
 * then one card of rows, each a link to the item's detail page (its title, in
 * one line cut with an ellipsis and whole on hover, then a mono line of its
 * short id and coverage; its type, who can find it, and when
 * it was published). From `sm` up the rows sit in columns under a small header;
 * on a phone each stacks, so nothing scrolls sideways. It is the snapshot draft
 * list's look, so the two Workspace pages read as one.
 *
 * The selected kind is the URL's `?kind=` (`useSearchParams`); the tabs push
 * it, and the list is filtered here, with what the search box says, which is
 * why this is a client component.
 */
export function MyDataTable({ items }: { items: MineItem[] }) {
  const kind = kindFromParam(useSearchParams().get("kind"));
  const [query, setQuery] = useState("");
  const counts = countByKind(items);
  const ofKind = filterByKind(items, kind);
  const rows = ofKind.filter((item) => matchesQuery(`${item.about.name} ${item.id}`, query));
  const tab = KIND_TABS.find((t) => t.value === kind) ?? KIND_TABS[0];

  return (
    <>
      <ListToolbar>
        <MyDataKindTabs active={kind} counts={counts} />
        {ofKind.length > 0 && (
          <SearchField
            value={query}
            onChange={setQuery}
            label="Search snapshots and inputs by name"
            className="sm:w-72"
          />
        )}
      </ListToolbar>

      {ofKind.length === 0 ? (
        <div className="mt-4 rounded-card border border-dashed bg-card px-4 py-12 text-center shadow-card">
          <p className="mb-1 text-sm font-medium text-foreground">{tab.empty}</p>
          <p className="mx-auto mb-4 max-w-sm text-sm text-muted-foreground">Nothing of this type is in your list.</p>
          <Link
            href={kindHref("all")}
            onClick={pushOnPlainClick(kindHref("all"))}
            className="inline-flex min-h-10 items-center text-sm font-medium text-primary underline underline-offset-2"
          >
            Show all
          </Link>
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-card border border-border/70 bg-card text-card-foreground shadow-card">
          <div
            aria-hidden="true"
            className={`hidden gap-x-4 border-b bg-muted/60 px-6 py-3 font-mono text-[11px] tracking-[0.06em] text-muted-foreground uppercase sm:grid ${COLUMNS}`}
          >
            <span>Name</span>
            <span>Type</span>
            <span>Visibility</span>
            <span className="hidden md:block">Published</span>
          </div>

          {rows.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-sm font-medium text-foreground">Nothing matches &ldquo;{query.trim()}&rdquo;</p>
              <button
                type="button"
                onClick={() => setQuery("")}
                className="mt-3 inline-flex min-h-10 items-center rounded-md px-2 text-sm font-medium text-primary underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Clear search
              </button>
            </div>
          ) : (
            <ul aria-label="Snapshots and inputs" className="divide-y">
              {rows.map((item) => (
                <li
                  key={rowKey(item)}
                  className={`relative grid grid-cols-1 items-center gap-x-4 gap-y-1.5 px-4 py-3 transition-colors hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50 has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-inset has-[a:focus-visible]:ring-ring/50 motion-reduce:transition-none sm:gap-y-0 sm:px-6 sm:py-4 ${COLUMNS}`}
                >
                  <div className="min-w-0">
                    <Link
                      href={detailHref(item)}
                      title={item.about.name}
                      className={cn(clampClass(1), "text-[15px] font-medium text-foreground outline-none after:absolute after:inset-0 after:content-['']")}
                    >
                      {item.about.name}
                    </Link>
                    <p className="mt-0.5 font-mono text-xs break-words text-muted-foreground sm:truncate">
                      {shortId(item.id)} · {coverageLine(item)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:contents">
                    <KindLabel kind={item.kind} />
                    <VisibilityBadge visibility={item.visibility} />
                    <span className="font-mono text-xs text-muted-foreground sm:hidden md:block">
                      <span className="sr-only">Published </span>
                      <TimeStamp value={item.about.datePublished} format="date" />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
