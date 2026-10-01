import { notFound } from "next/navigation";
import { pathWithQuery } from "@/lib/auth-redirect";
import { redirectToSignIn, requireSession } from "@/lib/auth-guard";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { JobDetail } from "@/components/workspace/job-detail";
import { fetchMe } from "@/lib/account/actions";
import { fetchJob } from "@/lib/jobs/actions";
import { submitBlockedReason } from "@/lib/jobs/compute";
import { fetchDatasetById } from "@/lib/repository/actions";

/** A job of the signed-in user, as the backend has it. The dev-only design
 *  preview (`app/dev/workspace/[state]`) renders the same `JobDetail`. */
export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const here = pathWithQuery(`/workspace/${encodeURIComponent(id)}`, await searchParams);
  await requireSession(here);

  const result = await fetchJob(id);
  if (!result.ok) {
    if (result.reason === "session_expired") redirectToSignIn(here);
    if (result.reason === "not_found") notFound();
    throw new Error(result.message);
  }
  const job = result.data;
  const isDraft = job.status === "DRAFT";

  // Only a draft needs the snapshot: its own output variables to choose from,
  // and its recommended compute. Best-effort: a missing or unreadable source
  // dataset shouldn't block editing what the simulation already has.
  const dataset = isDraft ? await fetchDatasetById(job.dataset_id).catch(() => null) : null;

  // The signed-in user, for who may submit a draft (ADR 0024) and for "you
  // cancelled this". A failed lookup leaves the submit to the backend's answer.
  const needsMe = isDraft || job.status === "CANCELLED";
  const me = needsMe ? await fetchMe() : null;
  const blockedReason = isDraft ? submitBlockedReason(me) : null;
  const viewerEmail = job.status === "CANCELLED" ? (me?.email ?? null) : null;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <JobDetail
        job={job}
        dataset={dataset}
        viewerEmail={viewerEmail}
        blockedReason={blockedReason}
      />
      <Footer />
    </div>
  );
}
