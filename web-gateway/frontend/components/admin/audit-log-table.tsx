import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AuditCategory, AuditLogEntry } from "@/lib/admin/types";

function ActionBadge({ action }: { action: string }) {
  const isFailure = action.includes("failed") || action.includes("rejected");
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium ${
        isFailure ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700"
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
            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
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
        <p className="text-sm text-slate-500">No audit events yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Detail</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.id}>
                <TableCell>
                  <ActionBadge action={e.action} />
                </TableCell>
                <TableCell className="text-sm">
                  {e.actor_email ?? e.actor_id}
                </TableCell>
                <TableCell className="text-sm text-slate-500">
                  {e.target_id ?? "—"}
                </TableCell>
                <TableCell
                  className="text-xs text-slate-500 max-w-xs truncate"
                  title={e.detail ? JSON.stringify(e.detail, null, 2) : undefined}
                >
                  {e.detail ? JSON.stringify(e.detail) : "—"}
                </TableCell>
                <TableCell className="text-xs text-slate-500">
                  {new Date(e.created_at).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
