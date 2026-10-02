"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TimeStamp } from "@/components/common/time-stamp";
import { KindBadge } from "@/components/repository/kind-badge";
import { MyDataKindTabs, pushOnPlainClick } from "@/components/workspace/my-data-kind-tabs";
import { VisibilityBadge } from "@/components/workspace/visibility-badge";
import { coverageLine, detailHref } from "@/lib/repository/catalogue-format";
import type { MineItem } from "@/lib/repository/types";
import {
  KIND_TABS,
  countByKind,
  filterByKind,
  kindFromParam,
  kindHref,
} from "@/lib/workspace/my-data";

/** An id as a row shows it: enough to tell two apart, the rest one click away. */
function shortId(id: string): string {
  return `${id.slice(0, 8)}…`;
}

/** The row key: a snapshot and a model input could share an id. */
function rowKey(item: MineItem): string {
  return `${item.kind}:${item.id}`;
}

/**
 * The caller's snapshots and model inputs: the kind tabs, then a table from
 * `sm` up and stacked rows below it (as the simulation list does), so a phone
 * never scrolls sideways. Both are rendered and CSS shows one. From `md` up
 * the Coverage and Published columns join the table. A title opens the item's
 * detail page; that is all a row does.
 *
 * The selected kind is the URL's `?kind=` (`useSearchParams`); the tabs push
 * it, and the list is filtered here, which is why this is a client component.
 */
export function MyDataTable({ items }: { items: MineItem[] }) {
  const kind = kindFromParam(useSearchParams().get("kind"));
  const counts = countByKind(items);
  const rows = filterByKind(items, kind);
  const tab = KIND_TABS.find((t) => t.value === kind) ?? KIND_TABS[0];

  return (
    <>
      <MyDataKindTabs active={kind} counts={counts} />

      {rows.length === 0 ? (
        <Card className="mt-6 border-dashed">
          <CardContent className="py-12 text-center">
            <p className="mb-1 text-sm font-medium text-foreground">{tab.empty}</p>
            <p className="mx-auto mb-4 max-w-sm text-sm text-muted-foreground">
              Nothing of this type is in your list.
            </p>
            <Link
              href={kindHref("all")}
              onClick={pushOnPlainClick(kindHref("all"))}
              className="inline-flex min-h-10 items-center text-sm font-medium text-primary underline underline-offset-2"
            >
              Show all
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">Sorted by date added, newest first</p>
          <Card className="py-0">
            <CardContent className="p-0">
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Visibility</TableHead>
                      <TableHead className="hidden md:table-cell">Coverage</TableHead>
                      <TableHead className="hidden md:table-cell">Published</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((item) => (
                      <TableRow key={rowKey(item)}>
                        <TableCell className="max-w-72 font-medium whitespace-normal">
                          <Link
                            href={detailHref(item)}
                            className="text-foreground hover:text-primary hover:underline"
                          >
                            {item.about.name}
                          </Link>
                          <p className="font-mono text-xs font-normal text-muted-foreground">
                            {shortId(item.id)}
                          </p>
                        </TableCell>
                        <TableCell>
                          <KindBadge kind={item.kind} />
                        </TableCell>
                        <TableCell>
                          <VisibilityBadge visibility={item.visibility} />
                        </TableCell>
                        <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                          {coverageLine(item)}
                        </TableCell>
                        <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                          <TimeStamp value={item.about.datePublished} format="date" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <ul aria-label="Snapshots and inputs" className="divide-y sm:hidden">
                {rows.map((item) => (
                  <li key={rowKey(item)} className="px-4 py-1.5">
                    <div className="min-w-0">
                      <Link
                        href={detailHref(item)}
                        className="block py-2.5 font-medium break-words text-foreground hover:text-primary hover:underline"
                      >
                        {item.about.name}
                      </Link>
                      <div className="flex flex-wrap items-center gap-2">
                        <KindBadge kind={item.kind} />
                        <VisibilityBadge visibility={item.visibility} />
                      </div>
                      <p className="mt-2 font-mono text-xs break-words text-muted-foreground">
                        {coverageLine(item)}
                      </p>
                      <p className="pt-1 pb-2.5 text-xs text-muted-foreground">
                        <span className="font-mono">{shortId(item.id)}</span>
                        {" · Published "}
                        <TimeStamp value={item.about.datePublished} format="date" />
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
