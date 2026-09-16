import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SimulationCard } from "@/components/jobs/simulation-card";
import { JobsStatsRow } from "@/components/jobs/jobs-stats-row";
import { fetchJobs, fetchJobStats } from "@/lib/jobs/actions";
import { STATUS_TABS } from "@/lib/jobs/filters";
import type { JobStatsResponse } from "@/lib/jobs/types";
import {
  ChevronLeft,
  ChevronRight,
  Play,
  Plus,
} from "lucide-react";

const EMPTY_STATS: JobStatsResponse = { total: 0, running: 0, completed: 0, failed: 0 };

export default async function SimulationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/auth/signin");

  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const statusFilter = params.status || undefined;

  const [data, stats] = await Promise.allSettled([
    fetchJobs(page, statusFilter),
    fetchJobStats(),
  ]);

  const jobData = data.status === "fulfilled" ? data.value : null;
  const statsData = stats.status === "fulfilled" ? stats.value : EMPTY_STATS;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        {/* Hero */}
        <div className="bg-gradient-to-br from-[#0a192f] to-[#006994] px-10 py-12">
          <div className="mx-auto max-w-[1024px]">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="mb-1 text-sm font-medium text-white/60 uppercase tracking-wider">
                  HPC Jobs
                </p>
                <h1 className="text-3xl font-bold text-white">My Simulations</h1>
                <p className="mt-2 text-sm text-white/70">
                  Submit and track hydrologic model simulations on Anvil HPC
                </p>
              </div>
              <Button
                asChild
                className="shrink-0 bg-white text-[#006994] hover:bg-white/90 font-semibold"
              >
                <Link href="/simulations/new">
                  <Plus className="mr-1.5 size-4" />
                  New Simulation
                </Link>
              </Button>
            </div>

            <JobsStatsRow stats={statsData} />
          </div>
        </div>

        {/* Content */}
        <div className="bg-slate-50 px-10 py-8">
          <div className="mx-auto max-w-[1024px]">
            {/* Filter tabs */}
            <div className="mb-6 flex flex-wrap gap-2">
              {STATUS_TABS.map((tab) => {
                const isActive =
                  statusFilter === tab.value ||
                  (!statusFilter && tab.value === undefined);
                const href = tab.value
                  ? `/simulations?status=${tab.value}`
                  : "/simulations";
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

            {/* Job list */}
            {!jobData ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-red-600">
                  Failed to load simulations. Make sure the backend is running.
                </CardContent>
              </Card>
            ) : jobData.items.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-20 text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#006994]/10">
                    <Play className="size-7 text-[#006994]" />
                  </div>
                  <p className="mb-1 text-sm font-medium text-foreground">
                    {statusFilter ? "No simulations found" : "No simulations yet"}
                  </p>
                  <p className="mb-6 text-sm text-muted-foreground">
                    {statusFilter
                      ? "Try a different filter or create a new simulation."
                      : "Select a model snapshot to run your first simulation."}
                  </p>
                  <Button asChild size="sm" className="bg-[#006994] hover:bg-[#005a7a]">
                    <Link href="/simulations/new">
                      <Plus className="mr-1.5 size-4" />
                      New Simulation
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {jobData.items.map((job) => (
                  <SimulationCard key={job.id} job={job} />
                ))}

                {/* Pagination */}
                {jobData.total_pages > 1 && (
                  <div className="flex items-center justify-center gap-4 pt-4">
                    {page > 1 ? (
                      <Link
                        href={`/simulations?page=${page - 1}${statusFilter ? `&status=${statusFilter}` : ""}`}
                      >
                        <Button variant="ghost" size="sm">
                          <ChevronLeft className="mr-1 size-4" />
                          Previous
                        </Button>
                      </Link>
                    ) : (
                      <Button variant="ghost" size="sm" disabled>
                        <ChevronLeft className="mr-1 size-4" />
                        Previous
                      </Button>
                    )}

                    <span className="text-sm text-muted-foreground">
                      Page {page} of {jobData.total_pages}
                    </span>

                    {page < jobData.total_pages ? (
                      <Link
                        href={`/simulations?page=${page + 1}${statusFilter ? `&status=${statusFilter}` : ""}`}
                      >
                        <Button variant="ghost" size="sm">
                          Next
                          <ChevronRight className="ml-1 size-4" />
                        </Button>
                      </Link>
                    ) : (
                      <Button variant="ghost" size="sm" disabled>
                        Next
                        <ChevronRight className="ml-1 size-4" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
