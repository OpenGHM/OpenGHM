import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionHeader } from "@/components/admin/section-header";
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
import type { JobStatsResponse } from "@/lib/jobs/types";
import type { AuditLogListResponse, TimeSeriesResponse, StatusBreakdownResponse } from "@/lib/admin/types";

const EMPTY_STATS: JobStatsResponse = {
  total: 0,
  running: 0,
  completed: 0,
  failed: 0,
  draft: 0,
  cancelled: 0,
};
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

  const stats = statsResult.status === "fulfilled" ? statsResult.value : EMPTY_STATS;
  const userCount = usersResult.status === "fulfilled" ? usersResult.value.total_count : null;
  const auditLog = auditResult.status === "fulfilled" ? auditResult.value : EMPTY_AUDIT;
  const jobsSeries = jobsSeriesResult.status === "fulfilled" ? jobsSeriesResult.value : EMPTY_SERIES;
  const signupsSeries = signupsSeriesResult.status === "fulfilled" ? signupsSeriesResult.value : EMPTY_SERIES;
  const breakdown = breakdownResult.status === "fulfilled" ? breakdownResult.value : EMPTY_BREAKDOWN;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <SectionHeader title="Admin" description="Site-wide activity at a glance." />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-2xl font-bold text-slate-900">{userCount ?? "—"}</p>
            <p className="text-sm text-slate-500">Total users</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
            <p className="text-sm text-slate-500">Total jobs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-2xl font-bold text-amber-600">{stats.running}</p>
            <p className="text-sm text-slate-500">Running</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-2xl font-bold text-emerald-600">{stats.completed}</p>
            <p className="text-sm text-slate-500">Completed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
            <p className="text-sm text-slate-500">Failed</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Jobs submitted (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            {jobsSeriesResult.status === "rejected" ? (
              <p className="text-sm text-slate-500">Metrics unavailable.</p>
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
              <p className="text-sm text-slate-500">Metrics unavailable.</p>
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
            <p className="text-sm text-slate-500">Metrics unavailable.</p>
          ) : (
            <StatusBreakdownChart items={breakdown.items} total={breakdown.total} />
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/admin/users">
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="py-4">
              <p className="font-medium text-slate-900">Manage users →</p>
              <p className="text-sm text-slate-500">Roles, status, sessions.</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/jobs">
          <Card className="transition-shadow hover:shadow-md">
            <CardContent className="py-4">
              <p className="font-medium text-slate-900">Site-wide jobs →</p>
              <p className="text-sm text-slate-500">All simulations across users.</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/audit">
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
            <p className="text-red-600 text-sm">Failed to load audit log.</p>
          ) : (
            <AuditLogTable entries={auditLog.items.slice(0, 8)} showFilters={false} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
