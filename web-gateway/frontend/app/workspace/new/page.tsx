import { isUnauthorizedError, redirectToSignIn, requireSession } from "@/lib/auth-guard";
import Link from "next/link";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { displayStatus } from "@/lib/jobs/display-status";
import { RecentSnapshots } from "@/components/workspace/recent-snapshots";
import { fetchJobs } from "@/lib/jobs/actions";
import { fetchDatasetById } from "@/lib/repository/actions";
import type { Dataset } from "@/lib/repository/types";
import { displayName } from "@/lib/jobs/display-name";
import type { Job } from "@/lib/jobs/types";
import { Compass, Play } from "lucide-react";

const RECENTS_LIMIT = 5;

/**
 * The new-simulation entry screen: not an empty search box (spec.md's
 * In scope). A user with past simulations sees the snapshots they've
 * already used and their own recent simulations, both derived from `jobs`
 * with no new backend field; a user with none sees a single way in — the
 * picker (`/workspace/new/pick`), which is the repository's own search.
 */
export default async function NewSimulationEntryPage() {
  await requireSession("/workspace/new");

  let jobs: Job[] = [];
  try {
    const jobData = await fetchJobs(1);
    jobs = jobData.items;
  } catch (error) {
    if (isUnauthorizedError(error)) redirectToSignIn("/workspace/new");
    // Backend unavailable — falls through to the empty state.
  }

  const recentSimulations = jobs.slice(0, RECENTS_LIMIT);

  const distinctDatasetIds: string[] = [];
  for (const job of jobs) {
    if (!distinctDatasetIds.includes(job.dataset_id)) distinctDatasetIds.push(job.dataset_id);
    if (distinctDatasetIds.length >= RECENTS_LIMIT) break;
  }
  const settled = await Promise.allSettled(distinctDatasetIds.map((id) => fetchDatasetById(id)));
  const recentSnapshots: Dataset[] = settled
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((d): d is Dataset => d !== null);

  const hasHistory = jobs.length > 0;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <div className="bg-gradient-to-br from-hero to-primary px-10 py-12">
          <div className="mx-auto max-w-[1024px]">
            <p className="mb-1 text-sm font-medium text-white/60 uppercase tracking-wider">
              Workspace
            </p>
            <h1 className="text-3xl font-bold text-white">New Simulation</h1>
            <p className="mt-2 text-sm text-white/70">
              Start from a model snapshot you&apos;ve used before, or browse the full catalogue.
            </p>
          </div>
        </div>

        <div className="bg-slate-50 px-10 py-10">
          <div className="mx-auto max-w-[1024px] space-y-10">
            {!hasHistory ? (
              <Card className="border-dashed">
                <CardContent className="py-20 text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                    <Compass className="size-7 text-primary" />
                  </div>
                  <p className="mb-1 text-sm font-medium text-foreground">
                    You haven&apos;t run anything yet
                  </p>
                  <p className="mb-6 text-sm text-muted-foreground">
                    Browse the Data Repository&apos;s published model snapshots to start your first
                    simulation.
                  </p>
                  <Button asChild className="font-semibold">
                    <Link href="/workspace/new/pick">
                      <Compass className="mr-1.5 size-4" />
                      Browse Model Snapshots
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                {recentSnapshots.length > 0 && (
                  <section>
                    <div className="mb-4 flex items-center justify-between">
                      <h2 className="text-lg font-semibold text-foreground">
                        Model Snapshots you&apos;ve used
                      </h2>
                      <Button asChild variant="ghost" size="sm">
                        <Link href="/workspace/new/pick">
                          <Compass className="mr-1.5 size-4" />
                          Browse all
                        </Link>
                      </Button>
                    </div>
                    <RecentSnapshots snapshots={recentSnapshots} />
                  </section>
                )}

                <section>
                  <h2 className="mb-4 text-lg font-semibold text-foreground">
                    Your recent simulations
                  </h2>
                  <Card className="py-0">
                    <CardContent className="divide-y p-0">
                      {recentSimulations.map((job) => (
                        <Link
                          key={job.id}
                          href={`/workspace/${job.id}`}
                          className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">
                              {displayName(job)}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {job.dataset_title}
                            </p>
                          </div>
                          <JobStatusBadge status={displayStatus(job)} />
                        </Link>
                      ))}
                    </CardContent>
                  </Card>
                </section>
              </>
            )}

            <section className="flex items-center justify-center gap-3 border-t pt-8">
              <Button asChild size="lg" className="font-semibold">
                <Link href="/workspace/new/pick">
                  <Play className="mr-1.5 size-4" />
                  Browse all model snapshots
                </Link>
              </Button>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
