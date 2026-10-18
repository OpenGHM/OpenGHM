import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminPage } from "@/components/admin/admin-page";
import { EmptyState, InlineError } from "@/components/admin/admin-states";
import { UserRoleStatusCard } from "@/components/admin/user-role-status-card";
import { UserSessionsTable } from "@/components/admin/user-sessions-table";
import { AuditLogTable } from "@/components/admin/audit-log-table";
import { DraftCard } from "@/components/jobs/draft-card";
import { fetchUserDetail, fetchUserSessions, fetchAuditLog, fetchUserLabels } from "@/lib/admin/actions";
import { auditHref } from "@/lib/admin/audit-href";
import { signInIfUnauthorized } from "@/lib/admin/load";
import { fetchJobs } from "@/lib/jobs/actions";
import type { SessionListResponse } from "@/lib/account/types";

export const metadata: Metadata = { title: "User | OpenGHM Admin" };

const VIEW_ALL =
  "inline-flex min-h-10 items-center text-sm text-primary hover:underline sm:min-h-0";

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
    fetchAuditLog(1, { actor_id: id }, 5),
  ]);
  signInIfUnauthorized(`/admin/users/${id}`, [sessionsResult, jobsResult, auditResult]);

  const sessions = sessionsResult.status === "fulfilled" ? sessionsResult.value : EMPTY_SESSIONS;
  const recentJobs = jobsResult.status === "fulfilled" ? jobsResult.value.items.slice(0, 5) : [];
  // What this user did, newest first: the backend filters by actor, so the
  // slice is the user's own however busy the site is.
  const userAuditEntries = auditResult.status === "fulfilled" ? auditResult.value.items : [];
  const people = await fetchUserLabels(
    userAuditEntries.flatMap((e) => [e.actor_id, ...(e.target_id ? [e.target_id] : [])])
  );

  return (
    <AdminPage
      title={user.name}
      description={user.email}
      breadcrumb={[
        { label: "Admin", href: "/admin" },
        { label: "Users", href: "/admin/users" },
        { label: user.name },
      ]}
    >
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
                  <span className="text-sm font-normal text-muted-foreground">
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
                <>
                  {recentJobs.map((job) => (
                    <DraftCard key={job.id} job={job} />
                  ))}
                  <Link href={`/admin/jobs?user_id=${encodeURIComponent(id)}`} className={VIEW_ALL}>
                    View all
                  </Link>
                </>
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
                <>
                  <AuditLogTable entries={userAuditEntries} people={people} showFilters={false} />
                  {userAuditEntries.length > 0 && (
                    <Link href={auditHref("/admin/audit", { actor_id: id })} className={`${VIEW_ALL} mt-3`}>
                      View all
                    </Link>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminPage>
  );
}
