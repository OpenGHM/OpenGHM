import { notFound } from "next/navigation";
import { pathWithQuery } from "@/lib/auth-redirect";
import { redirectToSignIn, requireSession } from "@/lib/auth-guard";
import { Footer } from "@/components/landing/footer";
import { DraftWizard } from "@/components/workspace/draft-wizard";
import { JobDetail } from "@/components/workspace/job-detail";
import { fetchMe } from "@/lib/account/actions";
import { fetchJob } from "@/lib/jobs/actions";
import { runsClimatology, submitBlockedReason } from "@/lib/jobs/compute";
import { fetchDatasetById } from "@/lib/repository/actions";
import type { Dataset } from "@/lib/repository/types";
import type { DraftContext } from "@/lib/workspace/draft-state";
import { parseStep, recommendedComputeFor } from "@/lib/workspace/draft-wizard";

/**
 * A job of the signed-in user, as the backend has it. A DRAFT opens the draft
 * wizard (`?step=run|review`, Review when absent); every other status
 * is the status page. The dev-only design preview (`app/dev/workspace/[state]`)
 * renders the same `JobDetail` for the statuses.
 */
export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const here = pathWithQuery(`/workspace/${encodeURIComponent(id)}`, query);
  await requireSession(here);

  const result = await fetchJob(id);
  if (!result.ok) {
    if (result.reason === "session_expired") redirectToSignIn(here);
    if (result.reason === "not_found") notFound();
    throw new Error(result.message);
  }
  const job = result.data;

  if (job.status === "DRAFT") {
    // The snapshot the draft starts from: null means it left the repository,
    // a throw means it could not be read just now. The wizard tells them
    // apart, because only the first can never be submitted.
    let ctx: DraftContext;
    try {
      const dataset = await fetchDatasetById(job.dataset_id);
      ctx = dataset ? { dataset, snapshotState: "found" } : { dataset: null, snapshotState: "gone" };
    } catch {
      ctx = { dataset: null, snapshotState: "unavailable" };
    }
    // Who may submit (ADR 0024). A failed lookup leaves it to the backend's answer.
    const me = await fetchMe();
    return (
      <div className="flex min-h-screen flex-col">
          <DraftWizard
          key={job.id}
          job={job}
          ctx={ctx}
          blockedReason={submitBlockedReason(me)}
          initialStep={parseStep(query.step)}
        />
        <Footer />
      </div>
    );
  }

  // "You cancelled this" needs to know who is looking.
  const viewerEmail = job.status === "CANCELLED" ? ((await fetchMe())?.email ?? null) : null;

  // The base snapshot, read once for two things: what the job asked for when it
  // chose no cores or walltime of its own (its recommendation; snapshots never
  // change, so reading it now gives what the submit read), and the `about` the
  // publish form fills from when the draft stores none. Null when it cannot be
  // read just now: the page then shows a dash, and the form starts as the draft
  // has it, rather than a guess.
  let base: Dataset | null = null;
  try {
    base = await fetchDatasetById(job.dataset_id);
  } catch {
    base = null;
  }
  const recommended = recommendedComputeFor(base);

  return (
    <div className="flex min-h-screen flex-col">
      <JobDetail
        job={job}
        viewerEmail={viewerEmail}
        recommended={recommended}
        postProcessing={runsClimatology(job.parameters.post_processing, base?.postProcessing)}
        baseAbout={base?.about ?? null}
        coverage={base?.simulation.temporalCoverage ?? null}
      />
      <Footer />
    </div>
  );
}
