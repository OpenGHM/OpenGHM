import { JobHero } from "@/components/workspace/job-hero";
import { JobStatusSummary } from "@/components/workspace/job-status-summary";
import { JobDetails } from "@/components/workspace/job-details";
import { LogViewer } from "@/components/workspace/log-viewer";
import { LiveJobProvider } from "@/components/workspace/live-job-provider";
import { AboutSummaryCard } from "@/components/workspace/about-summary-card";
import type { Recommended } from "@/lib/jobs/compute";
import type { Job, JobLive, LogStream } from "@/lib/jobs/types";

/**
 * The job detail page below the site header: the hero (breadcrumb, the
 * simulation's name and status, a menu of actions) and, in the order a person
 * reads it, the status summary (is it running, did it work, why not, where are
 * the results), the logs, and the details of the run. One view for two routes:
 * the real page (`app/workspace/[id]`) renders it from the backend, and the
 * dev-only design preview (`app/dev/workspace/[state]`) from the fixtures,
 * with `preview` set. Fetching stays in the pages; nothing here reads a fixture.
 *
 * Every status sits inside one `LiveJobProvider`, hero included, so the header,
 * the summary and the logs read the same poll. A DRAFT is not shown here: it is
 * the draft wizard's (`draft-wizard.tsx`).
 */
export function JobDetail({
  job,
  viewerEmail,
  recommended = null,
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
        live: previewLive,
      }}
      preview={preview}
    >
      <main className="flex flex-1 flex-col">
        <JobHero job={job} preview={preview} />
        <div className="flex-1 bg-slate-50 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
          <div className="mx-auto max-w-[1024px] space-y-8">
            <JobStatusSummary job={job} viewerEmail={viewerEmail} preview={preview} />
            <LogViewer previewLogs={previewLogs} />
            <JobDetails job={job} recommended={recommended} />
            <AboutSummaryCard about={job.about} />
          </div>
        </div>
      </main>
    </LiveJobProvider>
  );
}
