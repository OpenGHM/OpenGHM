"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Boxes, FileInput, PackageOpen, Search } from "lucide-react";
import { TimeStamp } from "@/components/common/time-stamp";
import { clampClass } from "@/components/common/clamped-name";
import { GlyphTile, HEADER_ROW, ListEmptyCard, ROW_CARD } from "@/components/workspace/list-card";
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

/** The columns from `lg` up. Written whole because Tailwind reads source text. */
const COLUMNS = "lg:grid-cols-[minmax(0,1fr)_9rem_6.5rem_7.5rem]";

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
 * then a stack of row cards, each a link to the item's detail page: a tile with
 * the kind's icon, its title (one line cut with an ellipsis, whole on hover)
 * over a mono line of its short id and coverage; its type, who can find it, and
 * when it was published. From `lg` up the rows sit in columns under a mono
 * header; below it each stacks in two lines, so nothing scrolls sideways. It is
 * the snapshot draft list's look (`list-card.tsx`), so the two Workspace pages
 * read as one.
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
            className="lg:w-72 xl:w-[26rem]"
          />
        )}
      </ListToolbar>

      {ofKind.length === 0 ? (
        <ListEmptyCard dashed className="mt-4 shadow-card" icon={<PackageOpen />} title={tab.empty} hint="Nothing of this type is in your list.">
          <Link
            href={kindHref("all")}
            onClick={pushOnPlainClick(kindHref("all"))}
            className="inline-flex min-h-10 items-center text-sm font-medium text-primary underline underline-offset-2"
          >
            Show all
          </Link>
        </ListEmptyCard>
      ) : (
        <div className="mt-4 flex flex-col gap-3.5">
          {rows.length === 0 ? (
            <ListEmptyCard icon={<Search />} title={<>Nothing matches &ldquo;{query.trim()}&rdquo;</>}>
              <button
                type="button"
                onClick={() => setQuery("")}
                className="inline-flex min-h-10 items-center rounded-[11px] bg-hero px-4 text-[13.5px] font-semibold text-white outline-none transition-colors hover:bg-hero/90 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Clear search
              </button>
            </ListEmptyCard>
          ) : (
            <>
              <div aria-hidden="true" className={cn(HEADER_ROW, COLUMNS)}>
                <span className="lg:pl-[62px]">Name</span>
                <span>Type</span>
                <span>Visibility</span>
                <span>Published</span>
              </div>
              <ul aria-label="Snapshots and inputs" className="flex flex-col gap-2">
                {rows.map((item) => {
                  const Icon = item.kind === "snapshot" ? Boxes : FileInput;
                  return (
                    <li
                      key={rowKey(item)}
                      className={cn(
                        ROW_CARD,
                        "grid grid-cols-1 items-center gap-x-4 gap-y-2.5 px-4 py-3.5 sm:px-5 sm:py-4",
                        COLUMNS,
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                        <GlyphTile tone={item.kind === "snapshot" ? "bg-secondary text-primary" : "bg-compute/10 text-compute"}>
                          <Icon className="size-5" />
                        </GlyphTile>
                        <div className="min-w-0">
                          <Link
                            href={detailHref(item)}
                            title={item.about.name}
                            className={cn(clampClass(1), "text-base font-[550] tracking-[-0.01em] text-foreground outline-none after:absolute after:inset-0 after:content-['']")}
                          >
                            {item.about.name}
                          </Link>
                          <p className="mt-1.5 font-mono text-xs break-words text-muted-foreground lg:truncate">
                            {shortId(item.id)} · {coverageLine(item)}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-[52px] sm:pl-[62px] lg:contents">
                        <KindLabel kind={item.kind} />
                        <VisibilityBadge visibility={item.visibility} />
                        <span className="font-mono text-xs text-muted-foreground">
                          <span className="sr-only">Published </span>
                          <TimeStamp value={item.about.datePublished} format="date" />
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </>
  );
}
