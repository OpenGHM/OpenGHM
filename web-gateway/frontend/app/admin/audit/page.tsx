import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminPage } from "@/components/admin/admin-page";
import { InlineError } from "@/components/admin/admin-states";
import { AuditLogTable } from "@/components/admin/audit-log-table";
import { Person } from "@/components/admin/person";
import { ServerPagination } from "@/components/shared/server-pagination";
import { fetchAuditLog, fetchUserLabels } from "@/lib/admin/actions";
import { auditHref, parseDay } from "@/lib/admin/audit-href";
import { loadOrSignIn } from "@/lib/admin/load";
import { pathWithQuery } from "@/lib/auth-redirect";
import type { AuditFilters, AuditLogListResponse } from "@/lib/admin/types";

export const metadata: Metadata = { title: "Audit log | OpenGHM Admin" };

const EMPTY_AUDIT: AuditLogListResponse = { items: [], total_count: 0, page: 1, total_pages: 1 };

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; category?: string; actor_id?: string; date_from?: string; date_to?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const category =
    params.category === "auth" ||
    params.category === "job" ||
    params.category === "system" ||
    params.category === "content"
      ? params.category
      : undefined;
  const filters: AuditFilters = {
    category,
    actor_id: params.actor_id?.trim().slice(0, 128) || undefined,
    date_from: parseDay(params.date_from),
    date_to: parseDay(params.date_to),
  };

  const auditResult = await loadOrSignIn(pathWithQuery("/admin/audit", params), () =>
    fetchAuditLog(page, filters)
  );
  const auditLog = auditResult ?? EMPTY_AUDIT;
  // One call names every actor and every target that is a user, and the actor filtered to.
  const people = await fetchUserLabels([
    ...auditLog.items.flatMap((e) => [e.actor_id, ...(e.target_id ? [e.target_id] : [])]),
    ...(filters.actor_id ? [filters.actor_id] : []),
  ]);

  return (
    <AdminPage title="Audit log" description="Authentication, job and content activity across the site.">
      {filters.actor_id && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          Events by <Person id={filters.actor_id} labels={people} className="text-foreground" />
          <Link
            href={auditHref("/admin/audit", { ...filters, actor_id: undefined })}
            className="inline-flex min-h-10 items-center text-primary hover:underline sm:min-h-0"
          >
            Clear
          </Link>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{auditResult === null ? "Events" : `${auditLog.total_count} events`}</CardTitle>
        </CardHeader>
        <CardContent>
          {auditResult === null ? (
            <InlineError title="Couldn't load the audit log." />
          ) : (
            <>
              <AuditLogTable entries={auditLog.items} filters={filters} people={people} basePath="/admin/audit" />
              <ServerPagination
                page={page}
                totalPages={auditLog.total_pages}
                basePath="/admin/audit"
                params={{ ...filters }}
              />
            </>
          )}
        </CardContent>
      </Card>
    </AdminPage>
  );
}
