"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JobStatusBadge, STATUS_LABEL } from "@/components/jobs/job-status-badge";
import { ActionError } from "@/components/workspace/action-error";
import { DuplicateDraftButton } from "@/components/workspace/duplicate-draft-button";
import { PageHeader, DraftBreadcrumb } from "@/components/workspace/page-header";
import { JobActionsMenu } from "@/components/workspace/job-actions-menu";
import { JobDeleteButton } from "@/components/workspace/job-delete-button";
import { useLiveJobContext } from "@/components/workspace/live-job-provider";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { displayName } from "@/lib/jobs/display-name";
import { displayStatus, type DisplayStatus } from "@/lib/jobs/display-status";
import type { Job } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";
import { summaryOffersCopy } from "@/lib/workspace/failure-copy";
import { newStepHref } from "@/lib/workspace/draft-wizard";

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
 * Repository's, in the wide column: breadcrumb, the snapshot draft's own name
 * with its status and, once the job has ended, "Duplicate", "New from this model
 * snapshot" and Delete on the right (from `sm`; on a phone one "More actions"
 * menu holds the same, `JobActionsMenu`). What the job is based on, its run id
 * and its Slurm job are in the "Run details" card, once.
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
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteExpired, setDeleteExpired] = useState(false);

  const shown = displayStatus({ status, cancel_requested_at: view.cancel_requested_at });
  const ended = isTerminalStatus(status);
  const offersDuplicate = ended && !summaryOffersCopy(status, view.failure ?? job.failure);
  const name = displayName(job);
  const clearDeleteFailure = () => {
    setDeleteError(null);
    setDeleteExpired(false);
  };

  return (
    <PageHeader
      wide
      top={<DraftBreadcrumb current={name} />}
      title={name}
      badge={<JobStatusBadge status={shown} />}
      aside={
        ended ? (
          <>
            <div className="hidden flex-wrap items-center gap-3 sm:flex sm:justify-end">
              {offersDuplicate && (
                <DuplicateDraftButton
                  jobId={job.id}
                  label="Duplicate"
                  variant="outline"
                  Icon={Copy}
                  className="shrink-0 font-medium"
                />
              )}
              <Button asChild variant="outline" className="min-h-10 shrink-0 gap-2">
                <Link href={newStepHref(job.dataset_id, "run")}>
                  <FlaskConical aria-hidden="true" />
                  New from this model snapshot
                </Link>
              </Button>
              <JobDeleteButton
                jobId={job.id}
                isDraft={false}
                workDir={view.work_dir ?? job.work_dir}
                remoteJobDir={job.remote_job_dir}
                files={view.files ?? job.files}
                preview={preview}
                onOpen={clearDeleteFailure}
                onError={setDeleteError}
                onSessionExpired={() => setDeleteExpired(true)}
              />
            </div>
            <JobActionsMenu
              className="sm:hidden"
              jobId={job.id}
              datasetId={job.dataset_id}
              offersDuplicate={offersDuplicate}
              workDir={view.work_dir ?? job.work_dir}
              remoteJobDir={job.remote_job_dir}
              files={view.files ?? job.files}
              preview={preview}
              onDeleteOpen={clearDeleteFailure}
              onDeleteError={setDeleteError}
              onDeleteSessionExpired={() => setDeleteExpired(true)}
            />
          </>
        ) : undefined
      }
    >
      {deleteExpired && (
        <SessionExpiredBanner className="mt-4 w-full sm:max-w-md" />
      )}
      {deleteError && (
        <div className="mt-4">
          <ActionError>{deleteError}</ActionError>
        </div>
      )}
      <StatusAnnouncer status={shown} />
    </PageHeader>
  );
}
