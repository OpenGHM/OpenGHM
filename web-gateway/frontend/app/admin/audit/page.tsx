import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminPage, InlineError } from "@/components/admin/admin-page";
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
  const category = params.category === "auth" || params.category === "job" || params.category === "system" ? params.category : undefined;

  const auditResult = await fetchAuditLog(page, category).catch(() => null);
  const auditLog = auditResult ?? EMPTY_AUDIT;

  return (
    <AdminPage>
      <SectionHeader title="Audit log" description="Authentication and job activity across the site." />

      <Card>
        <CardHeader>
          <CardTitle>{auditResult === null ? "Events" : `${auditLog.total_count} events`}</CardTitle>
        </CardHeader>
        <CardContent>
          {auditResult === null ? (
            <InlineError title="Couldn't load the audit log." />
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
    </AdminPage>
  );
}
