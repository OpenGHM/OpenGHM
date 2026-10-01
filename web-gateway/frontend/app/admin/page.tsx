import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminPage, InlineError } from "@/components/admin/admin-page";
import { SectionHeader } from "@/components/admin/section-header";
import { SiteStatsCards } from "@/components/admin/site-stats-cards";
import { AuditLogTable } from "@/components/admin/audit-log-table";
import { BarChart } from "@/components/charts/bar-chart";
import { StatusBreakdownChart } from "@/components/charts/status-breakdown-chart";
import {
  fetchAuditLog,
  fetchSiteJobStats,
  fetchUsers,
  fetchTimeSeries,
  fetchJobStatusBreakdown,
} from "@/lib/admin/actions";
import type { AuditLogListResponse, TimeSeriesResponse, StatusBreakdownResponse } from "@/lib/admin/types";

const EMPTY_AUDIT: AuditLogListResponse = { items: [], total_count: 0, page: 1, total_pages: 1 };
const EMPTY_SERIES: TimeSeriesResponse = {
  metric: "", granularity: "day", timezone: "UTC", start: "", end: "", total: 0, points: [],
};
const EMPTY_BREAKDOWN: StatusBreakdownResponse = { items: [], total: 0, since: null };

export default async function AdminOverviewPage() {
  const [statsResult, usersResult, auditResult, jobsSeriesResult, signupsSeriesResult, breakdownResult] =
    await Promise.allSettled([
      fetchSiteJobStats(),
      fetchUsers(1),
      fetchAuditLog(1),
      fetchTimeSeries("jobs", 30),
      fetchTimeSeries("registrations", 30),
      fetchJobStatusBreakdown(),
    ]);

  // A figure that could not be loaded shows a dash, not a zero.
  const stats = statsResult.status === "fulfilled" ? statsResult.value : null;
  const userCount = usersResult.status === "fulfilled" ? usersResult.value.total_count : null;
  const auditLog = auditResult.status === "fulfilled" ? auditResult.value : EMPTY_AUDIT;
  const jobsSeries = jobsSeriesResult.status === "fulfilled" ? jobsSeriesResult.value : EMPTY_SERIES;
  const signupsSeries = signupsSeriesResult.status === "fulfilled" ? signupsSeriesResult.value : EMPTY_SERIES;
  const breakdown = breakdownResult.status === "fulfilled" ? breakdownResult.value : EMPTY_BREAKDOWN;

  return (
    <AdminPage>
      <SectionHeader title="Admin" description="Site-wide activity at a glance." />

      {(statsResult.status === "rejected" || usersResult.status === "rejected") && (
        <InlineError title="Some totals could not be loaded.">
          They show a dash for now. Reload the page to try again.
        </InlineError>
      )}

      <SiteStatsCards stats={stats} userCount={userCount} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Jobs submitted (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            {jobsSeriesResult.status === "rejected" ? (
              <InlineError title="Couldn't load this chart." />
            ) : (
              <BarChart points={jobsSeries.points} colorVar="var(--chart-2)" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>New signups (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            {signupsSeriesResult.status === "rejected" ? (
              <InlineError title="Couldn't load this chart." />
            ) : (
              <BarChart points={signupsSeries.points} colorVar="var(--chart-1)" />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Job status breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {breakdownResult.status === "rejected" ? (
            <InlineError title="Couldn't load this chart." />
          ) : (
            <StatusBreakdownChart items={breakdown.items} total={breakdown.total} />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/admin/users" className="block min-h-10 rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="py-4">
              <p className="font-medium text-slate-900">Manage users →</p>
              <p className="text-sm text-slate-500">Roles, status, sessions.</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/jobs" className="block min-h-10 rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="py-4">
              <p className="font-medium text-slate-900">Site-wide jobs →</p>
              <p className="text-sm text-slate-500">All simulations across users.</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/audit" className="block min-h-10 rounded-xl focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="py-4">
              <p className="font-medium text-slate-900">Audit log →</p>
              <p className="text-sm text-slate-500">Auth and job event history.</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {auditResult.status === "rejected" ? (
            <InlineError title="Couldn't load recent activity." />
          ) : (
            <AuditLogTable entries={auditLog.items.slice(0, 8)} showFilters={false} />
          )}
        </CardContent>
      </Card>
    </AdminPage>
  );
}
