import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { pathWithQuery } from "@/lib/auth-redirect";
import { isUnauthorizedError, redirectToSignIn, requireSession } from "@/lib/auth-guard";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SimulationListSkeleton } from "@/components/workspace/simulation-list-skeleton";
import { SimulationListTabs } from "@/components/workspace/simulation-list-tabs";
import { SimulationTable } from "@/components/workspace/simulation-table";
import { WorkspaceHero } from "@/components/workspace/workspace-hero";
import { fetchJobs, fetchJobStats } from "@/lib/jobs/actions";
import { listHref, tabForStatus } from "@/lib/jobs/filters";
import { AlertCircle, ChevronLeft, ChevronRight, Play, Plus } from "lucide-react";

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const here = pathWithQuery("/workspace", params);
  await requireSession(here);

  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const page = Math.max(1, Number(first(params.page)) || 1);
  const statusFilter = first(params.status) || undefined;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <WorkspaceHero section="simulations" />

        {/* Content */}
        <div className="bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
          <div className="mx-auto max-w-[1024px]">
            {/* Keyed by the URL so a click on a tab shows the skeleton again. */}
            <Suspense key={here} fallback={<SimulationListSkeleton />}>
              <SimulationList here={here} page={page} statusFilter={statusFilter} />
            </Suspense>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

/** The tab bar and what it selects. Async, so the page around it (and the
 *  skeleton) is on screen while the backend answers. */
async function SimulationList({
  here,
  page,
  statusFilter,
}: {
  here: string;
  page: number;
  statusFilter: string | undefined;
}) {
  const [data, stats] = await Promise.allSettled([
    fetchJobs(page, statusFilter),
    fetchJobStats(),
  ]);

  // A 401 with a session that looked fine: the backend no longer accepts the
  // token. Sign in again rather than showing an empty list.
  for (const r of [data, stats]) {
    if (r.status === "rejected" && isUnauthorizedError(r.reason)) redirectToSignIn(here);
  }

  const jobData = data.status === "fulfilled" ? data.value : null;
  // Without counts the tabs still navigate; zeros would be a false answer.
  const statsData = stats.status === "fulfilled" ? stats.value : null;
  const tab = tabForStatus(statusFilter);

  // The last row of the last page was just deleted: the page is gone, the
  // list is not. Go to the new last page.
  if (jobData && jobData.items.length === 0 && page > jobData.total_pages) {
    redirect(listHref(statusFilter, jobData.total_pages));
  }

  return (
    <>
      <SimulationListTabs active={tab} stats={statsData} />

      {!jobData ? (
        <div
          role="alert"
          className="mt-6 flex items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">Couldn&apos;t load your simulations.</p>
            <p>
              Nothing was changed.{" "}
              <Link href={here} className="font-medium underline underline-offset-2">
                Try again
              </Link>
            </p>
          </div>
        </div>
      ) : jobData.items.length === 0 ? (
        <Card className="mt-6 border-dashed">
          <CardContent className="py-16 text-center sm:py-20">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Play className="size-7 text-primary" />
            </div>
            <p className="mb-1 text-sm font-medium text-foreground">
              {tab ? tab.empty.title : "No simulations found"}
            </p>
            <p className="mx-auto mb-6 max-w-sm text-sm text-muted-foreground">
              {tab ? tab.empty.hint : "This filter matches nothing. Pick one of the tabs above."}
            </p>
            <div className="flex flex-col items-center justify-center gap-2 sm:flex-row">
              <Button asChild size="sm" className="min-h-10 sm:min-h-8">
                <Link href="/workspace/new">
                  <Plus className="mr-1.5 size-4" />
                  New Simulation
                </Link>
              </Button>
              {statusFilter && (
                <Button asChild size="sm" variant="ghost" className="min-h-10 sm:min-h-8">
                  <Link href={listHref(undefined)}>Show all simulations</Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-muted-foreground">Sorted by last update</p>
          <Card className="py-0">
            <CardContent className="p-0">
              <SimulationTable jobs={jobData.items} />
            </CardContent>
          </Card>

          {/* Pagination: an end of the list is a disabled button, not a gap. */}
          {jobData.total_pages > 1 && (
            <nav
              aria-label="Pages"
              className="flex items-center justify-center gap-4 pt-4"
            >
              {page > 1 ? (
                <Button asChild variant="ghost" size="sm" className="min-h-10 sm:min-h-8">
                  <Link href={listHref(statusFilter, page - 1)}>
                    <ChevronLeft className="mr-1 size-4" />
                    Previous
                  </Link>
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled
                  aria-disabled="true"
                  className="min-h-10 sm:min-h-8"
                >
                  <ChevronLeft className="mr-1 size-4" />
                  Previous
                </Button>
              )}

              <span className="text-sm text-muted-foreground">
                Page {page} of {jobData.total_pages}
              </span>

              {page < jobData.total_pages ? (
                <Button asChild variant="ghost" size="sm" className="min-h-10 sm:min-h-8">
                  <Link href={listHref(statusFilter, page + 1)}>
                    Next
                    <ChevronRight className="ml-1 size-4" />
                  </Link>
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled
                  aria-disabled="true"
                  className="min-h-10 sm:min-h-8"
                >
                  Next
                  <ChevronRight className="ml-1 size-4" />
                </Button>
              )}
            </nav>
          )}
        </div>
      )}
    </>
  );
}
