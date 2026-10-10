import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { pathWithQuery } from "@/lib/auth-redirect";
import { isUnauthorizedError, redirectToSignIn, workspaceSession } from "@/lib/auth-guard";
import { SignInRequired } from "@/components/workspace/sign-in-required";
import { Footer } from "@/components/landing/footer";
import { Button } from "@/components/ui/button";
import { LinkPending } from "@/components/ui/link-pending";
import { PageBody } from "@/components/layout/page-hero";
import { DraftListSkeleton } from "@/components/workspace/draft-list-skeleton";
import { DraftListTabs } from "@/components/workspace/draft-list-tabs";
import { DraftPager } from "@/components/workspace/draft-pager";
import { DraftSearchInput, DraftSearchProvider } from "@/components/workspace/draft-search";
import { DraftTable } from "@/components/workspace/draft-table";
import { ListEmptyCard } from "@/components/workspace/list-card";
import { ListToolbar } from "@/components/workspace/list-toolbar";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { fetchJobs, fetchJobStats } from "@/lib/jobs/actions";
import { runNotes } from "@/lib/jobs/run-notes";
import {
  PAGE_SIZES,
  listHref,
  parsePageSize,
  parseSort,
  tabForStatus,
  type ListSort,
} from "@/lib/jobs/filters";
import { AlertCircle, ArrowUpDown, Play, Plus } from "lucide-react";

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const here = pathWithQuery("/workspace", params);
  const access = await workspaceSession();
  if ("signedOut" in access) return <SignInRequired reason={access.signedOut} here={here} />;

  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const page = Math.max(1, Number(first(params.page)) || 1);
  const statusFilter = first(params.status) || undefined;
  const pageSize = parsePageSize(first(params.size));
  const sort = parseSort(first(params.sort));

  return (
    <div className="flex min-h-screen flex-col">
      <WorkspaceHeader section="drafts" />
      <PageBody className="flex-1">
        {/* Not keyed by the URL: a click on a tab or a page link is a
            transition, so the list on screen stays until the next one is
            ready, and the link that was clicked shows a spinner if that
            takes a while. The skeleton is only for the first load. */}
        <Suspense fallback={<DraftListSkeleton />}>
          <DraftList here={here} page={page} statusFilter={statusFilter} pageSize={pageSize} sort={sort} />
        </Suspense>
      </PageBody>
      <Footer />
    </div>
  );
}

/** What the sort link calls each order. */
const SORT_LABEL: Record<ListSort, string> = { updated: "Updated", created: "Created" };

/** The tab bar and what it selects. Async, so the page around it (and the
 *  skeleton) is on screen while the backend answers. */
async function DraftList({
  here,
  page,
  statusFilter,
  pageSize,
  sort,
}: {
  here: string;
  page: number;
  statusFilter: string | undefined;
  pageSize: number;
  sort: ListSort;
}) {
  const [data, stats] = await Promise.allSettled([
    fetchJobs(page, statusFilter, undefined, { pageSize, sort }),
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
  // What a click on a tab or a page keeps: the page size and the order.
  const view = { size: pageSize, sort };
  const otherSort: ListSort = sort === "updated" ? "created" : "updated";

  // The last row of the last page was just deleted: the page is gone, the
  // list is not. Go to the new last page.
  if (jobData && jobData.items.length === 0 && page > jobData.total_pages) {
    redirect(listHref(statusFilter, jobData.total_pages, view));
  }

  // Whether a simulation is shorter than its snapshot's coverage needs the snapshot,
  // which the job does not carry: read here, once per distinct snapshot.
  const notes = jobData ? await runNotes(jobData.items) : {};
  const hasRows = !!jobData && jobData.items.length > 0;

  return (
    <DraftSearchProvider>
      <ListToolbar>
        <DraftListTabs active={tab} stats={statsData} view={view} />
        {hasRows && (
          <div className="flex min-w-0 items-center gap-2 lg:shrink-0">
            <DraftSearchInput className="flex-1 lg:w-72 lg:flex-none xl:w-[26rem]" />
            {/* The backend orders by when a draft last changed or when it was
                made; the link switches between the two and keeps the filter. */}
            <Link
              href={listHref(statusFilter, 1, { size: pageSize, sort: otherSort })}
              title={`Sorted by ${SORT_LABEL[sort].toLowerCase()}; sort by ${SORT_LABEL[otherSort].toLowerCase()} instead`}
              className="relative flex h-[42px] shrink-0 items-center gap-2 rounded-xl bg-muted px-3.5 text-[13.5px] font-semibold text-foreground outline-none transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <ArrowUpDown className="size-3.5" aria-hidden="true" />
              <span className="sr-only">Sort by: </span>
              {SORT_LABEL[sort]}
              <LinkPending className="top-0.5 right-0.5" />
            </Link>
          </div>
        )}
      </ListToolbar>

      {!jobData ? (
        <div
          role="alert"
          className="mt-4 flex items-start gap-3 rounded-card border border-destructive/25 bg-card p-5 text-sm text-destructive shadow-card"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium">Couldn&apos;t load your snapshot drafts.</p>
            <p>
              Nothing was changed.{" "}
              <Link href={here} className="font-medium underline underline-offset-2">
                Try again
              </Link>
            </p>
          </div>
        </div>
      ) : !hasRows ? (
        <ListEmptyCard
          dashed
          className="mt-4 shadow-card"
          icon={<Play />}
          title={tab ? tab.empty.title : "No snapshot drafts found"}
          hint={tab ? tab.empty.hint : "This filter matches nothing. Pick one of the tabs above."}
        >
          <Button asChild size="sm" className="min-h-10 sm:min-h-8">
            <Link href="/workspace/new">
              <Plus className="mr-1.5 size-4" />
              New snapshot
            </Link>
          </Button>
          {statusFilter && (
            <Button asChild size="sm" variant="ghost" className="min-h-10 sm:min-h-8">
              <Link href={listHref(undefined, 1, view)}>Show all snapshot drafts</Link>
            </Button>
          )}
        </ListEmptyCard>
      ) : (
        <div className="mt-4 flex flex-col gap-3.5">
          <DraftTable
            jobs={jobData.items}
            runNotes={notes}
            moreThanOnePage={jobData.total_pages > 1}
          />

          {/* The pager is there whenever the rows per page could be changed. */}
          {jobData.total_count > PAGE_SIZES[0] && (
            <DraftPager
              page={page}
              totalPages={jobData.total_pages}
              totalCount={jobData.total_count}
              pageSize={pageSize}
              status={statusFilter}
              sort={sort}
            />
          )}
        </div>
      )}
    </DraftSearchProvider>
  );
}
