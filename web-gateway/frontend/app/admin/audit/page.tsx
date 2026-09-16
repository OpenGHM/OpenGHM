import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeader } from "@/components/admin/section-header";
import { AuditLogTable } from "@/components/admin/audit-log-table";
import { ServerPagination } from "@/components/shared/server-pagination";
import { fetchAuditLog } from "@/lib/admin/actions";
import type { AuditLogListResponse } from "@/lib/admin/types";

const EMPTY_AUDIT: AuditLogListResponse = { items: [], total_count: 0, page: 1, total_pages: 1 };

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; category?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const category = params.category === "auth" || params.category === "job" ? params.category : undefined;

  const auditResult = await fetchAuditLog(page, category).catch(() => null);
  const auditLog = auditResult ?? EMPTY_AUDIT;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <SectionHeader title="Audit log" description="Authentication and job activity across the site." />

      <Card>
        <CardHeader>
          <CardTitle>{auditLog.total_count} events</CardTitle>
        </CardHeader>
        <CardContent>
          {auditResult === null ? (
            <p className="text-red-600 text-sm">Failed to load audit log.</p>
          ) : (
            <>
              <AuditLogTable entries={auditLog.items} activeCategory={category} basePath="/admin/audit" />
              <ServerPagination
                page={page}
                totalPages={auditLog.total_pages}
                basePath="/admin/audit"
                params={{ category }}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
