import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/admin/section-header";
import { AdminJobsTable } from "@/components/admin/admin-jobs-table";
import { ServerPagination } from "@/components/shared/server-pagination";
import { fetchJobs } from "@/lib/jobs/actions";
import { STATUS_TABS } from "@/lib/jobs/filters";
import type { JobListResponse } from "@/lib/jobs/types";

const EMPTY_JOBS: JobListResponse = { items: [], total_count: 0, page: 1, total_pages: 1 };

export default async function AdminJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string; user_id?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const statusFilter = params.status || undefined;
  const userId = params.user_id || undefined;

  const jobsResult = await fetchJobs(page, statusFilter, userId || "*").catch(() => null);
  const jobData = jobsResult ?? EMPTY_JOBS;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-8">
      <SectionHeader title="Jobs" description="Simulations across every user." />

      {userId && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          Filtered to user <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{userId}</code>
          <Link href="/admin/jobs" className="text-primary hover:underline">
            Clear
          </Link>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => {
          const isActive = statusFilter === tab.value || (!statusFilter && tab.value === undefined);
          const search = new URLSearchParams();
          if (tab.value) search.set("status", tab.value);
          if (userId) search.set("user_id", userId);
          const href = search.size > 0 ? `/admin/jobs?${search.toString()}` : "/admin/jobs";
          return (
            <Link key={tab.label} href={href}>
              <span
                className={`inline-block rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                  isActive
                    ? "bg-[#006994] text-white shadow-sm"
                    : "bg-white text-muted-foreground border hover:bg-slate-50"
                }`}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>

      <Card>
        <CardContent className="pt-6">
          {jobsResult === null ? (
            <p className="text-red-600 text-sm">Failed to load jobs.</p>
          ) : (
            <>
              <AdminJobsTable jobs={jobData.items} />
              <ServerPagination
                page={page}
                totalPages={jobData.total_pages}
                basePath="/admin/jobs"
                params={{ status: statusFilter, user_id: userId }}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
