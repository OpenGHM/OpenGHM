import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { pathWithQuery } from "@/lib/auth-redirect";
import { isUnauthorizedError, redirectToSignIn, requireSession } from "@/lib/auth-guard";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { StartProgress } from "@/components/workspace/draft-progress";
import { StartFrom } from "@/components/workspace/start-from";
import { fetchJobs } from "@/lib/jobs/actions";
import { fetchDatasetById, fetchDatasets, fetchModelInputIds } from "@/lib/repository/actions";
import { parseDatasetFilters, toURLSearchParams } from "@/lib/repository/url-filters";
import type { Dataset, RepositoryListResponse } from "@/lib/repository/types";
import type { Job } from "@/lib/jobs/types";
import { parseFrom } from "@/lib/workspace/start-mode";

const RECENTS_LIMIT = 5;

const EMPTY_RESULT: RepositoryListResponse = {
  items: [],
  totalCount: 0,
  totalPages: 1,
  page: 1,
};

/**
 * Step 1 of the draft wizard (ADR 0028): where a new simulation starts from.
 * The server reads what the cards need once: the caller's first page of
 * simulations (the snapshots they have used, and the list to copy from), and
 * the picker's first result for the URL's filters. `?from=copy` opens the other
 * card.
 */
export default async function NewSimulationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  const here = pathWithQuery("/workspace/new", rawParams);
  await requireSession(here);

  const params = toURLSearchParams(rawParams);
  const filters = parseDatasetFilters(params);
  const initialMode = parseFrom(params.get("from"));

  // The picker's reads are best effort: the picker retries on interaction, and
  // the badge degrades to "Checking…" without the model-input ids.
  const datasetsRead = fetchDatasets(filters).catch((): RepositoryListResponse => EMPTY_RESULT);
  const modelInputIdsRead = fetchModelInputIds().catch(() => null);

  let jobs: Job[] = [];
  let copyInitial: { items: Job[]; page: number; totalPages: number } | null = null;
  try {
    const jobData = await fetchJobs(1);
    jobs = jobData.items;
    copyInitial = { items: jobData.items, page: jobData.page, totalPages: jobData.total_pages };
  } catch (error) {
    if (isUnauthorizedError(error)) redirectToSignIn(here);
    // Backend unavailable: the copy list starts in its error state, with Retry.
  }

  const distinctDatasetIds: string[] = [];
  for (const job of jobs) {
    if (!distinctDatasetIds.includes(job.dataset_id)) distinctDatasetIds.push(job.dataset_id);
    if (distinctDatasetIds.length >= RECENTS_LIMIT) break;
  }
  // A snapshot that has left the repository comes back null and is dropped.
  const settled = await Promise.allSettled(distinctDatasetIds.map((id) => fetchDatasetById(id)));
  const recentSnapshots: Dataset[] = settled
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter((d): d is Dataset => d !== null);

  const [data, modelInputIds] = await Promise.all([datasetsRead, modelInputIdsRead]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex flex-1 flex-col">
        <div className="bg-gradient-to-br from-hero to-primary px-4 pt-6 pb-5 sm:px-6 sm:pt-8 lg:px-10">
          <div className="mx-auto max-w-[1024px]">
            <nav aria-label="Breadcrumb" className="text-sm text-white/70">
              <ol className="flex min-w-0 items-center gap-1.5">
                <li className="shrink-0">
                  <Link
                    href="/workspace"
                    className="rounded outline-none transition-colors hover:text-white focus-visible:ring-[3px] focus-visible:ring-white/70"
                  >
                    My Simulations
                  </Link>
                </li>
                <li aria-hidden="true" className="shrink-0">
                  <ChevronRight className="size-3.5" />
                </li>
                <li aria-current="page" className="min-w-0 truncate text-white">
                  New simulation
                </li>
              </ol>
            </nav>
            <h1 className="mt-4 text-2xl font-bold text-white">New simulation</h1>
            <p className="mt-2 text-sm text-white/70">Choose where it starts from</p>
            <div className="mt-6">
              <StartProgress />
            </div>
          </div>
        </div>

        <div className="flex-1 bg-slate-50 px-4 py-8 sm:px-6 lg:px-10">
          <div className="mx-auto max-w-[1024px]">
            <StartFrom
              initialMode={initialMode}
              recentSnapshots={recentSnapshots}
              copyInitial={copyInitial}
              picker={{ filters, data, modelInputIds }}
            />
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
