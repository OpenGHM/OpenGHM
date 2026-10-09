import Link from "next/link";
import { TableHead, TableRow } from "@/components/ui/table";
import {
  StackedBody,
  StackedCell,
  StackedHeader,
  StackedRow,
  StackedTable,
} from "@/components/admin/stacked-table";
import { EmptyState } from "@/components/admin/admin-states";
import { TimeStamp } from "@/components/common/time-stamp";
import type { AuditCategory, AuditLogEntry } from "@/lib/admin/types";

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
];

function CategoryTabs({
  active,
  basePath,
}: {
  active?: AuditCategory;
  basePath: string;
}) {
  return (
    <div className="flex gap-2 pb-3">
      {CATEGORY_TABS.map((tab) => {
        const isActive = tab.value === active;
        // Resets to page 1 — a page offset from one category rarely maps to
        // anything meaningful in another.
        const href = tab.value ? `${basePath}?category=${tab.value}` : basePath;
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
  );
}

export function AuditLogTable({
  entries,
  activeCategory,
  basePath = "/admin/audit",
  showFilters = true,
}: {
  entries: AuditLogEntry[];
  activeCategory?: AuditCategory;
  basePath?: string;
  showFilters?: boolean;
}) {
  return (
    <>
      {showFilters && <CategoryTabs active={activeCategory} basePath={basePath} />}
      {entries.length === 0 ? (
        <EmptyState title="No events to show.">
          {activeCategory
            ? "Nothing in this category yet. Try All."
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
                <StackedCell label="Actor" className="break-all text-sm">
                  {e.actor_email ?? e.actor_id}
                </StackedCell>
                <StackedCell label="Target" className="break-all text-sm text-muted-foreground">
                  {e.target_id ?? "—"}
                </StackedCell>
                <StackedCell
                  label="Detail"
                  className="break-all text-xs text-muted-foreground sm:max-w-xs sm:truncate"
                  title={e.detail ? JSON.stringify(e.detail, null, 2) : undefined}
                >
                  {e.detail ? JSON.stringify(e.detail) : "—"}
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
