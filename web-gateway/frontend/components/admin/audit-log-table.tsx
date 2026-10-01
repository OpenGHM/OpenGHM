import Link from "next/link";
import { TableHead, TableRow } from "@/components/ui/table";
import {
  StackedBody,
  StackedCell,
  StackedHeader,
  StackedRow,
  StackedTable,
} from "@/components/admin/stacked-table";
import { EmptyState } from "@/components/admin/admin-page";
import { TimeStamp } from "@/components/common/time-stamp";
import type { AuditCategory, AuditLogEntry } from "@/lib/admin/types";

function ActionBadge({ action }: { action: string }) {
  const isFailure = action.includes("failed") || action.includes("rejected");
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium ${
        isFailure ? "bg-destructive/10 text-destructive" : "bg-slate-100 text-slate-700"
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
            className={`inline-flex items-center rounded-md px-3 py-1 text-sm font-medium transition-colors max-sm:min-h-10 ${
              isActive
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
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
                <StackedCell label="Target" className="break-all text-sm text-slate-500">
                  {e.target_id ?? "—"}
                </StackedCell>
                <StackedCell
                  label="Detail"
                  className="break-all text-xs text-slate-500 sm:max-w-xs sm:truncate"
                  title={e.detail ? JSON.stringify(e.detail, null, 2) : undefined}
                >
                  {e.detail ? JSON.stringify(e.detail) : "—"}
                </StackedCell>
                <StackedCell label="When" className="text-xs text-slate-500">
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
