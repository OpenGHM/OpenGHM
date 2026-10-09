"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JobStatusPill, STATUS_LABEL } from "@/components/jobs/job-status-badge";
import { PageHero } from "@/components/layout/page-hero";
import { ActionError } from "@/components/workspace/action-error";
import { DuplicateDraftButton } from "@/components/workspace/duplicate-draft-button";
import { draftBreadcrumb } from "@/components/workspace/page-header";
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
import { cn } from "@/lib/utils";

/** An id the gateway made up (`sim-20261007-83f535`), shown in mono. */
const AUTO_ID = /^sim-/;

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
 * The page's navy band, the same shape as the draft wizard's and the Data
 * Repository's: breadcrumb, the status as a pill, the snapshot draft's own name
 * (mono when it is an auto id like `sim-…`), the title of the snapshot it is
 * based on and, once the job has ended, "Duplicate", "New from this model
 * snapshot" and Delete (from `sm`; on a phone one "More actions" menu holds the
 * same, `JobActionsMenu`). From `xl` the actions sit at the band's right edge,
 * level with the line under the title (the band's column is `relative`, and
 * they are laid over it); below `xl` they are a row under it. The base's
 * link, the run id and the Slurm job are in the "Run details" card, once.
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
    <PageHero
      size="page"
      breadcrumb={draftBreadcrumb(name)}
      // The pill is drawn on white so its status colour (made for a light
      // surface) stays readable on the navy.
      meta={
        <span className="inline-flex w-fit shrink-0 rounded-full bg-white">
          <JobStatusPill status={shown} />
        </span>
      }
      title={
        <span className={cn("[overflow-wrap:anywhere]", AUTO_ID.test(name) && "font-mono font-medium tracking-[-0.03em]")}>
          {name}
        </span>
      }
      subtitle={job.dataset_title}
    >
      {ended && (
        <div className="xl:absolute xl:right-7 xl:bottom-0">
          <div className="hidden flex-wrap items-center gap-2 sm:flex">
            {offersDuplicate && (
              <DuplicateDraftButton
                jobId={job.id}
                label="Duplicate"
                variant="on-dark"
                Icon={Copy}
                className="shrink-0 rounded-xl px-4 text-[13.5px]"
              />
            )}
            <Button asChild variant="on-dark" className="min-h-10 shrink-0 gap-2 rounded-xl px-4 text-[13.5px] font-semibold">
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
        </div>
      )}
      {deleteExpired && <SessionExpiredBanner className="w-full sm:max-w-md" />}
      {deleteError && <ActionError>{deleteError}</ActionError>}
      <StatusAnnouncer status={shown} />
    </PageHero>
  );
}
