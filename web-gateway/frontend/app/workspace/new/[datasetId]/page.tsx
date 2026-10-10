import { notFound } from "next/navigation";
import { pathWithQuery } from "@/lib/auth-redirect";
import { workspaceSession } from "@/lib/auth-guard";
import { SignInRequired } from "@/components/workspace/sign-in-required";
import { Footer } from "@/components/landing/footer";
import { DraftWizard } from "@/components/workspace/draft-wizard";
import { fetchMe } from "@/lib/account/actions";
import { previewDraft } from "@/lib/jobs/actions";
import { submitBlockedReason } from "@/lib/jobs/compute";
import { fetchDatasetById } from "@/lib/repository/actions";
import type { Dataset } from "@/lib/repository/types";
import type { DraftContext } from "@/lib/workspace/draft-state";
import { parseStep } from "@/lib/workspace/draft-wizard";

/**
 * A new snapshot draft, before it exists (ADR 0028): the draft wizard on a
 * snapshot's defaults, with nothing stored. The server reads the draft the
 * snapshot would give (`previewDraft`) and the snapshot itself; from there
 * everything the person chooses stays in the browser until "Save as draft" (or
 * Submit) creates the stored draft and opens it at `/workspace/<id>`.
 * `?step=run|review`, Run settings when absent: a new snapshot draft opens there.
 */
export default async function NewDraftFromSnapshotPage({
  params,
  searchParams,
}: {
  params: Promise<{ datasetId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { datasetId } = await params;
  const query = await searchParams;
  const here = pathWithQuery(`/workspace/new/${encodeURIComponent(datasetId)}`, query);
  const access = await workspaceSession();
  if ("signedOut" in access) return <SignInRequired reason={access.signedOut} here={here} />;

  const preview = await previewDraft(datasetId);
  if (!preview.ok) {
    if (preview.reason === "session_expired") return <SignInRequired reason="expired" here={here} />;
    if (preview.reason === "not_found") notFound();
    throw new Error(preview.message);
  }

  // The snapshot the draft starts from. One that left the repository cannot
  // start anything (the preview answers 404 for it too); one that could not be
  // read just now leaves the checks that need it to the backend.
  let dataset: Dataset | null = null;
  let unavailable = false;
  try {
    dataset = await fetchDatasetById(datasetId);
  } catch {
    unavailable = true;
  }
  if (!unavailable && !dataset) notFound();
  const ctx: DraftContext = unavailable
    ? { dataset: null, snapshotState: "unavailable" }
    : { dataset, snapshotState: "found" };

  // Who may submit (ADR 0024). A failed lookup leaves it to the backend's answer.
  const me = await fetchMe();

  return (
    <div className="flex min-h-screen flex-col">
      <DraftWizard
        key={datasetId}
        job={preview.data}
        mode={{ kind: "new", datasetId }}
        ctx={ctx}
        blockedReason={submitBlockedReason(me)}
        initialStep={parseStep(query.step, "run")}
      />
      <Footer />
    </div>
  );
}
