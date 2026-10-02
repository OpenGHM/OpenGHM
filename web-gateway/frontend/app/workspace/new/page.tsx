import { pathWithQuery } from "@/lib/auth-redirect";
import { isUnauthorizedError, redirectToSignIn, requireSession } from "@/lib/auth-guard";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { StartProgress } from "@/components/workspace/draft-progress";
import { PageHeader, SimulationBreadcrumb, WORKSPACE_MAIN } from "@/components/workspace/page-header";
import { StartFrom } from "@/components/workspace/start-from";
import { fetchJobs } from "@/lib/jobs/actions";
import { snapshotName } from "@/components/workspace/snapshot-label";
import { fetchDatasetById, fetchDatasets, fetchModelInputIds } from "@/lib/repository/actions";
import { parseDatasetFilters, toURLSearchParams } from "@/lib/repository/url-filters";
import type { Dataset, RepositoryListResponse } from "@/lib/repository/types";
import type { Job } from "@/lib/jobs/types";
import { parseFrom } from "@/lib/workspace/start-mode";

/** How many snapshots the copy list may look up by id for their short names,
 *  beyond the ones the picker's own result already holds. */
const NAME_LOOKUP_LIMIT = 12;

const EMPTY_RESULT: RepositoryListResponse = {
  items: [],
  totalCount: 0,
  totalPages: 1,
  page: 1,
};

/**
 * Step 1 of the draft wizard (ADR 0028): where a new simulation starts from.
 * The server reads what the screen needs once: the caller's first page of
 * simulations (which snapshots they have used, and the list to copy from), and
 * the picker's first result for the URL's filters. `?from=copy` opens the other
 * mode.
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

  const usedIds = [...new Set(jobs.map((job) => job.dataset_id))];

  const [data, modelInputIds] = await Promise.all([datasetsRead, modelInputIdsRead]);

  // The copy list names each simulation's snapshot in short: from what the
  // picker already holds, else by id. A snapshot that has left the repository
  // comes back null and is left out (the list shows the title it was made with).
  const known = new Map<string, Dataset>(data.items.map((d) => [d.id, d]));
  const lookups = await Promise.allSettled(
    usedIds.filter((id) => !known.has(id)).slice(0, NAME_LOOKUP_LIMIT).map((id) => fetchDatasetById(id))
  );
  for (const r of lookups) if (r.status === "fulfilled" && r.value) known.set(r.value.id, r.value);
  const snapshotNames: Record<string, string> = {};
  for (const id of usedIds) {
    const dataset = known.get(id);
    if (dataset) snapshotNames[id] = snapshotName(dataset);
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className={WORKSPACE_MAIN}>
        <PageHeader
          top={<SimulationBreadcrumb current="New simulation" />}
          title="New simulation"
          meta={<p className="mt-2.5 text-sm text-muted-foreground">Choose where it starts from</p>}
        >
          <StartProgress />
        </PageHeader>

        <div className="flex-1 px-4 py-8 sm:px-6 lg:px-10">
          <div className="mx-auto max-w-[1024px]">
            <StartFrom
              initialMode={initialMode}
              usedIds={usedIds}
              snapshotNames={snapshotNames}
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
