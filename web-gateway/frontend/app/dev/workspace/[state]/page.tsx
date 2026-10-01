import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth-guard";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { DevPreviewSwitcher } from "@/components/workspace/dev-preview-switcher";
import { JobDetail } from "@/components/workspace/job-detail";
import { fetchMe } from "@/lib/account/actions";
import { fakeLive, fakeLogs, previewSimulation } from "@/lib/workspace/fixtures";
import { resolvePreview } from "@/lib/workspace/preview";

// Built from the clock and the signed-in user on every request.
export const dynamic = "force-dynamic";

/**
 * The job detail page from a fixture, for looking at every status and every
 * verdict cause without making Anvil produce it (lib/workspace/preview.ts).
 * The same `JobDetail` the real page renders, with `preview` set: nothing is
 * polled, and the dialogs send nothing. Dev only: a 404 in production.
 */
export default async function DevWorkspacePreviewPage({
  params,
}: {
  params: Promise<{ state: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();

  const { state } = await params;
  const key = decodeURIComponent(state);
  await requireSession(`/dev/workspace/${encodeURIComponent(key)}`);

  const preview = resolvePreview(key);
  if (!preview) notFound();

  const me = await fetchMe();
  // "Cancelled by you" needs to know who you are.
  const viewerEmail = preview.key.startsWith("cancel") ? (me?.email ?? null) : null;
  const job = previewSimulation(preview.key, { overrides: { id: "preview" }, viewerEmail });

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <DevPreviewSwitcher active={preview.key} />
      <JobDetail
        job={job}
        dataset={null}
        viewerEmail={viewerEmail}
        blockedReason="This is a design preview; nothing can be submitted from it."
        preview
        previewLogs={fakeLogs(job.status)}
        previewLive={fakeLive(job)}
      />
      <Footer />
    </div>
  );
}
