import Link from "next/link";
import { Filter } from "lucide-react";
import { TableHead, TableRow } from "@/components/ui/table";
import {
  StackedBody,
  StackedCell,
  StackedHeader,
  StackedRow,
  StackedTable,
} from "@/components/admin/stacked-table";
import { EmptyState } from "@/components/admin/admin-states";
import { Person } from "@/components/admin/person";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimeStamp } from "@/components/common/time-stamp";
import { auditHref } from "@/lib/admin/audit-href";
import { detailView } from "@/lib/admin/audit-detail";
import type { AuditCategory, AuditFilters, AuditLogEntry, UserLabels } from "@/lib/admin/types";

function ActionBadge({ action }: { action: string }) {
  const isFailure = action.includes("failed") || action.includes("rejected");
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 font-mono text-[11.5px] ${
        isFailure ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground/80"
      }`}
    >
      {action}
    </span>
  );
}

const CATEGORY_TABS: { label: string; value: AuditCategory | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Auth", value: "auth" },
  { label: "Jobs", value: "job" },
  { label: "System", value: "system" },
  { label: "Content", value: "content" },
];

/** The category pills and the day range, each keeping the other filters. */
function AuditFilterBar({
  filters,
  basePath,
}: {
  filters: AuditFilters;
  basePath: string;
}) {
  const hasDays = Boolean(filters.date_from || filters.date_to);
  return (
    <div className="space-y-3 pb-3">
      <div className="flex flex-wrap gap-2">
        {CATEGORY_TABS.map((tab) => {
          const isActive = tab.value === filters.category;
          // Resets to page 1 — a page offset from one category rarely maps to
          // anything meaningful in another.
          const href = auditHref(basePath, { ...filters, category: tab.value });
          return (
            <Link
              key={tab.label}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={`inline-flex items-center rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors max-sm:min-h-10 ${
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "border bg-card text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      {/* A plain GET form: it works before the page's script has loaded. */}
      <form action={basePath} method="get" className="flex flex-wrap items-end gap-3">
        {filters.category && <input type="hidden" name="category" value={filters.category} />}
        {filters.actor_id && <input type="hidden" name="actor_id" value={filters.actor_id} />}
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">From</span>
          <Input type="date" name="date_from" defaultValue={filters.date_from ?? ""} className="w-40 max-sm:h-10" />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">To</span>
          <Input type="date" name="date_to" defaultValue={filters.date_to ?? ""} className="w-40 max-sm:h-10" />
        </label>
        <Button type="submit" variant="outline" className="max-sm:h-10">
          Apply dates
        </Button>
        {hasDays && (
          <Link
            href={auditHref(basePath, { ...filters, date_from: undefined, date_to: undefined })}
            className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground max-sm:min-h-10"
          >
            Clear dates
          </Link>
        )}
      </form>
    </div>
  );
}

/** An event's detail as `key: value` pairs; the whole JSON opens when the pairs lose something. */
function Detail({ detail }: { detail: Record<string, unknown> | null }) {
  const view = detailView(detail);
  if (!view) return <>—</>;
  if (!view.expandable) return <span className="break-words">{view.summary}</span>;
  return (
    <details className="group">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className="break-words">{view.summary}</span>{" "}
        <span className="whitespace-nowrap text-primary group-open:hidden">Show all</span>
        <span className="hidden whitespace-nowrap text-primary group-open:inline">Hide</span>
      </summary>
      <pre className="mt-1.5 max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap break-all text-foreground/80">
        {view.json}
      </pre>
    </details>
  );
}

export function AuditLogTable({
  entries,
  filters = {},
  people = {},
  basePath = "/admin/audit",
  showFilters = true,
}: {
  entries: AuditLogEntry[];
  /** What the list is narrowed to, so the pills and the day range keep each other. */
  filters?: AuditFilters;
  /** Name and email by user id (`fetchUserLabels`), for the actors and targets that are users. */
  people?: UserLabels;
  basePath?: string;
  showFilters?: boolean;
}) {
  const narrowed = Boolean(filters.category || filters.actor_id || filters.date_from || filters.date_to);
  return (
    <>
      {showFilters && <AuditFilterBar filters={filters} basePath={basePath} />}
      {entries.length === 0 ? (
        <EmptyState title="No events to show.">
          {narrowed
            ? "Nothing matches these filters. Widen the dates or try All."
            : "Sign-ins and job activity will appear here as they happen."}
        </EmptyState>
      ) : (
        <StackedTable>
          <StackedHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Detail</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </StackedHeader>
          <StackedBody>
            {entries.map((e) => (
              <StackedRow key={e.id}>
                <StackedCell>
                  <ActionBadge action={e.action} />
                </StackedCell>
                <StackedCell label="Actor" className="text-sm">
                  <div className="flex min-w-0 items-start gap-1.5">
                    <Person id={e.actor_id} labels={people} fallbackEmail={e.actor_email} />
                    {showFilters && (
                      <Link
                        href={auditHref(basePath, { ...filters, actor_id: e.actor_id })}
                        aria-label={`Show only events by ${people[e.actor_id]?.name || e.actor_email || e.actor_id}`}
                        title="Show only this actor's events"
                        className="mt-0.5 shrink-0 rounded-sm text-muted-foreground/70 hover:text-foreground"
                      >
                        <Filter className="size-3.5" aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                </StackedCell>
                <StackedCell label="Target" className="text-sm text-muted-foreground">
                  {e.target_id ? <Person id={e.target_id} labels={people} /> : "—"}
                </StackedCell>
                <StackedCell label="Detail" className="text-xs text-muted-foreground sm:max-w-xs">
                  <Detail detail={e.detail} />
                </StackedCell>
                <StackedCell label="When" className="text-xs text-muted-foreground">
                  <TimeStamp value={e.created_at} format="datetime" />
                </StackedCell>
              </StackedRow>
            ))}
          </StackedBody>
        </StackedTable>
      )}
    </>
  );
}
