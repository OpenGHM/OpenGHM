import { JobHeader } from "@/components/workspace/job-header";
import { AsideLayout } from "@/components/workspace/aside-layout";
import { WORKSPACE_MAIN } from "@/components/workspace/page-header";
import { JobStatusSummary } from "@/components/workspace/job-status-summary";
import { PublishCard } from "@/components/workspace/publish-card";
import { RunDetailsCard } from "@/components/workspace/run-details-card";
import { LogViewer } from "@/components/workspace/log-viewer";
import { LiveJobProvider } from "@/components/workspace/live-job-provider";
import { AboutSummaryCard } from "@/components/workspace/about-summary-card";
import type { Recommended } from "@/lib/jobs/compute";
import type { Job, JobLive, LogStream, PartialAbout } from "@/lib/jobs/types";

/**
 * The job detail page below the site header: the header (breadcrumb, the
 * snapshot draft's name and status, the actions) and, in the order a person
 * reads it, the status summary (is it running, did it work, why not, where are
 * the results, how long it took), the publish card, the logs, and the About card.
 * The facts of the simulation (what it is based on, the run period, the cores,
 * the Slurm job, the times) are the "Run details" card: from `xl` a sticky
 * column beside all of that, below it right after the status summary
 * (`AsideLayout`). One view for two routes:
 * the real page (`app/workspace/[id]`) renders it from the backend, and the
 * dev-only design preview (`app/dev/workspace/[state]`) from the fixtures,
 * with `preview` set. Fetching stays in the pages; nothing here reads a fixture.
 *
 * Every status sits inside one `LiveJobProvider`, header included, so the header,
 * the summary and the logs read the same poll. A DRAFT is not shown here: it is
 * the draft wizard's (`draft-wizard.tsx`).
 */
export function JobDetail({
  job,
  viewerEmail,
  recommended = null,
  postProcessing = false,
  baseAbout = null,
  preview = false,
  previewLogs,
  previewLive = null,
}: {
  job: Job;
  /** The signed-in user's email, for "you cancelled this". */
  viewerEmail: string | null;
  /** The base snapshot's `recommendedCompute`, for the cores and walltime a
   *  job asked for by default; null when the snapshot could not be read. */
  recommended?: Recommended | null;
  /** The job post-processed (climatology), which its default walltime allowed for. */
  postProcessing?: boolean;
  /** The base snapshot's `about`, which the publish form fills what the draft
   *  stores none of from; null when the snapshot could not be read. */
  baseAbout?: PartialAbout | null;
  /** Fixture data: nothing is polled and the dialogs send nothing. */
  preview?: boolean;
  /** The logs to show instead of fetching them. Preview only. */
  previewLogs?: Partial<Record<LogStream, string>>;
  /** What SLURM would have said. Preview only. */
  previewLive?: JobLive | null;
}) {
  // One poll loop for the whole page: the header, the summary and the logs all
  // read the same answer.
  return (
    <LiveJobProvider
      jobId={job.id}
      initialStatus={job.status}
      initialData={{
        slurm_job_id: job.slurm_job_id,
        submitted_at: job.submitted_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        status_reason: job.status_reason,
        work_dir: job.work_dir,
        slurm_state: job.slurm_state,
        slurm_exit_code: job.slurm_exit_code,
        slurm_start: job.slurm_start,
        slurm_end: job.slurm_end,
        failure: job.failure,
        cancel_requested_at: job.cancel_requested_at,
        cancel_requested_by_email: job.cancel_requested_by_email,
        files: job.files,
        output: job.output,
        publish: job.publish,
        live: previewLive,
      }}
      preview={preview}
    >
      <main className={WORKSPACE_MAIN}>
        <JobHeader job={job} preview={preview} />
        <AsideLayout
          label="Run details"
          below="flow"
          className="py-6 sm:py-8"
          lead={<JobStatusSummary job={job} viewerEmail={viewerEmail} preview={preview} />}
          aside={<RunDetailsCard job={job} recommended={recommended} postProcessing={postProcessing} />}
        >
          <PublishCard job={job} baseAbout={baseAbout} preview={preview} />
          <LogViewer previewLogs={previewLogs} />
          <AboutSummaryCard about={job.about} />
        </AsideLayout>
      </main>
    </LiveJobProvider>
  );
}
