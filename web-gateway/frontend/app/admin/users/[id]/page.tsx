import { auth } from "@/lib/auth";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminPage, EmptyState, InlineError } from "@/components/admin/admin-page";
import { UserRoleStatusCard } from "@/components/admin/user-role-status-card";
import { UserSessionsTable } from "@/components/admin/user-sessions-table";
import { AuditLogTable } from "@/components/admin/audit-log-table";
import { DraftCard } from "@/components/jobs/draft-card";
import { fetchUserDetail, fetchUserSessions, fetchAuditLog } from "@/lib/admin/actions";
import { fetchJobs } from "@/lib/jobs/actions";
import type { SessionListResponse } from "@/lib/account/types";

const EMPTY_SESSIONS: SessionListResponse = { items: [] };

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  const isAdmin = session?.user.role === "admin";

  const user = await fetchUserDetail(id);
  if (user === null) notFound();

  const [sessionsResult, jobsResult, auditResult] = await Promise.allSettled([
    isAdmin ? fetchUserSessions(id) : Promise.resolve(EMPTY_SESSIONS),
    fetchJobs(1, undefined, id),
    fetchAuditLog(1),
  ]);

  const sessions = sessionsResult.status === "fulfilled" ? sessionsResult.value : EMPTY_SESSIONS;
  const recentJobs = jobsResult.status === "fulfilled" ? jobsResult.value.items.slice(0, 5) : [];
  // No actor-filter param exists on the audit-log endpoint yet — filter the
  // first page in memory rather than adding server-side pagination for a
  // per-user slice that's rarely more than a handful of rows.
  const userAuditEntries =
    auditResult.status === "fulfilled"
      ? auditResult.value.items.filter((e) => e.actor_id === id || e.target_id === id).slice(0, 5)
      : [];

  return (
    <AdminPage>
      <Link
        href="/admin/users"
        className="inline-flex min-h-10 items-center gap-1 text-sm text-slate-500 hover:text-slate-700 sm:min-h-0"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Back to users
      </Link>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-1">
          <UserRoleStatusCard user={user} isSelf={user.id === session?.user.id} canManage={isAdmin} />
        </div>

        <div className="min-w-0 space-y-6 lg:col-span-2">
          {isAdmin &&
            (sessionsResult.status === "rejected" ? (
              <Card>
                <CardHeader>
                  <CardTitle>Sessions</CardTitle>
                </CardHeader>
                <CardContent>
                  <InlineError title="Couldn't load this user's sessions." />
                </CardContent>
              </Card>
            ) : (
              <UserSessionsTable userId={id} sessions={sessions.items} />
            ))}

          <Card>
            <CardHeader>
              <CardTitle>
                Recent jobs {user.job_counts && Object.keys(user.job_counts).length > 0 && (
                  <span className="text-sm font-normal text-slate-500">
                    ({Object.entries(user.job_counts).map(([status, count]) => `${count} ${status.toLowerCase()}`).join(", ")})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {jobsResult.status === "rejected" ? (
                <InlineError title="Couldn't load this user's jobs." />
              ) : recentJobs.length === 0 ? (
                <EmptyState title="No jobs submitted yet.">
                  Their snapshot drafts will appear here once they start one.
                </EmptyState>
              ) : (
                recentJobs.map((job) => <DraftCard key={job.id} job={job} />)
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent activity</CardTitle>
            </CardHeader>
            <CardContent>
              {auditResult.status === "rejected" ? (
                <InlineError title="Couldn't load this user's activity." />
              ) : (
                <AuditLogTable entries={userAuditEntries} showFilters={false} />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminPage>
  );
}
