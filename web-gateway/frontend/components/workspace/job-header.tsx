"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, FlaskConical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JobStatusBadge, STATUS_LABEL } from "@/components/jobs/job-status-badge";
import { ActionError } from "@/components/workspace/action-error";
import { DuplicateSimulationButton } from "@/components/workspace/duplicate-simulation-button";
import { PageHeader, SimulationBreadcrumb } from "@/components/workspace/page-header";
import { JobDeleteButton } from "@/components/workspace/job-delete-button";
import { useLiveJobContext } from "@/components/workspace/live-job-provider";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { displayName } from "@/lib/jobs/display-name";
import { displayStatus, type DisplayStatus } from "@/lib/jobs/display-status";
import { useCreateDraft } from "@/lib/jobs/use-create-draft";
import type { Job } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";
import { summaryOffersCopy } from "@/lib/workspace/failure-copy";

/**
 * Says "Status: Running" to a screen reader when the status changes, and not
 * when the page first renders. The one live region for status: the badges
 * around the page are not.
 */
function StatusAnnouncer({ status }: { status: DisplayStatus }) {
  const [seen, setSeen] = useState(status);
  const [message, setMessage] = useState("");
  // Compared while rendering, not in an effect, so the first render says nothing.
  if (status !== seen) {
    setSeen(status);
    setMessage(`Status: ${STATUS_LABEL[status]}`);
  }
  return (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </p>
  );
}

/**
 * The page's header, the same shape as the draft wizard's and the Data
 * Repository's: breadcrumb, the simulation's own name with its status, one
 * muted line saying which snapshot it is based on (its title, cut to one line,
 * the whole title on hover; and the run id and SLURM job), and, once the job has
 * ended, "Duplicate", "New from this model snapshot" and Delete on the right.
 * Cancel and "Try again with these settings" live in the status summary, where
 * the job is: a failed or cancelled job has its copy action there, so the header
 * adds "Duplicate" only for the ended jobs whose summary has none (a completed
 * one), and a page never shows the same action twice (`summaryOffersCopy`).
 *
 * Render it inside a `LiveJobProvider`. A DRAFT has no header here: the draft
 * wizard has its own.
 */
export function JobHeader({ job, preview = false }: { job: Job; preview?: boolean }) {
  const { status, view } = useLiveJobContext();
  const { pending, error, deriveFrom } = useCreateDraft();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteExpired, setDeleteExpired] = useState(false);

  const shown = displayStatus({ status, cancel_requested_at: view.cancel_requested_at });
  const ended = isTerminalStatus(status);
  const offersDuplicate = ended && !summaryOffersCopy(status, view.failure ?? job.failure);
  const name = displayName(job);
  const meta = [name !== job.sim_id ? job.sim_id : null, job.slurm_job_id ? `Slurm #${job.slurm_job_id}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <PageHeader
      top={<SimulationBreadcrumb current={name} />}
      title={name}
      badge={<JobStatusBadge status={shown} />}
      meta={
        <div className="mt-2.5 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <Link
            href={`/repository/${job.dataset_id}`}
            title={job.dataset_title}
            className="max-w-full truncate rounded underline-offset-2 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Based on {job.dataset_title}
          </Link>
          {meta && <span className="font-mono text-xs break-words">{meta}</span>}
        </div>
      }
      aside={
        ended ? (
          <div className="flex flex-wrap items-center gap-3 sm:justify-end">
            {offersDuplicate && (
              <DuplicateSimulationButton
                jobId={job.id}
                label="Duplicate"
                variant="outline"
                Icon={Copy}
                className="shrink-0 font-medium"
              />
            )}
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => void deriveFrom(job.dataset_id)}
              className="min-h-10 shrink-0 gap-2"
            >
              {pending ? (
                <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <FlaskConical aria-hidden="true" />
              )}
              New from this model snapshot
            </Button>
            <JobDeleteButton
              jobId={job.id}
              isDraft={false}
              workDir={view.work_dir ?? job.work_dir}
              remoteJobDir={job.remote_job_dir}
              files={view.files ?? job.files}
              preview={preview}
              onOpen={() => {
                setDeleteError(null);
                setDeleteExpired(false);
              }}
              onError={setDeleteError}
              onSessionExpired={() => setDeleteExpired(true)}
            />
          </div>
        ) : undefined
      }
    >
      {(deleteExpired || error?.kind === "session-expired") && (
        <SessionExpiredBanner className="mt-4 w-full sm:max-w-md" />
      )}
      {deleteError && (
        <div className="mt-4">
          <ActionError>{deleteError}</ActionError>
        </div>
      )}
      {error?.kind === "error" && (
        <div className="mt-4">
          <ActionError>{error.message}</ActionError>
        </div>
      )}
      <StatusAnnouncer status={shown} />
    </PageHeader>
  );
}
