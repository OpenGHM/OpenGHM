import { pathWithQuery } from "@/lib/auth-redirect";
import { isUnauthorizedError, redirectToSignIn, requireSession } from "@/lib/auth-guard";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { StartProgress } from "@/components/workspace/draft-progress";
import { PageHeader, DraftBreadcrumb, WORKSPACE_MAIN } from "@/components/workspace/page-header";
import { StartFrom } from "@/components/workspace/start-from";
import { WizardLayout } from "@/components/workspace/wizard-layout";
import { fetchJobs } from "@/lib/jobs/actions";
import { fetchModelInputIds, fetchSnapshots } from "@/lib/repository/actions";
import { parsePickerFilters, toURLSearchParams } from "@/lib/repository/url-filters";
import type { CatalogueResponse } from "@/lib/repository/types";

/**
 * Step 1 of the draft wizard (ADR 0028): choose a model snapshot. The server
 * reads what the screen needs once: the picker's first result for the URL's
 * search and filters, and which snapshots the caller has based a recent
 * snapshot draft on (the first page of their snapshot drafts), for the "Used before"
 * mark.
 */
export default async function NewDraftPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const rawParams = await searchParams;
  const here = pathWithQuery("/workspace/new", rawParams);
  await requireSession(here);

  const filters = parsePickerFilters(toURLSearchParams(rawParams));

  // The picker's reads are best effort: it asks again on interaction (and has
  // a Retry), and the badge degrades to "Checking…" without the model-input ids.
  const snapshotsRead = fetchSnapshots(filters).catch((): CatalogueResponse | null => null);
  const modelInputIdsRead = fetchModelInputIds().catch(() => null);

  let usedIds: string[] = [];
  try {
    const { items } = await fetchJobs(1);
    usedIds = [...new Set(items.map((job) => job.dataset_id))];
  } catch (error) {
    if (isUnauthorizedError(error)) redirectToSignIn(here);
    // Backend unavailable: nothing is marked as used.
  }

  const [data, modelInputIds] = await Promise.all([snapshotsRead, modelInputIdsRead]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className={WORKSPACE_MAIN}>
        <PageHeader
          wide
          top={<DraftBreadcrumb current="New snapshot" />}
          title="New snapshot"
          meta={<p className="mt-2.5 text-sm text-muted-foreground">Start from a published model snapshot</p>}
        >
          <StartProgress />
        </PageHeader>

        <WizardLayout step="start" facts={{}} className="py-8">
          <StartFrom usedIds={usedIds} picker={{ filters, data, modelInputIds }} />
        </WizardLayout>
      </main>
      <Footer />
    </div>
  );
}
