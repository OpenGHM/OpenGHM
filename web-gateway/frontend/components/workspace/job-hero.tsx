"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, FlaskConical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JobStatusBadge, STATUS_LABEL } from "@/components/jobs/job-status-badge";
import { HERO_BUTTON, HeroError } from "@/components/workspace/hero-button";
import { JobDeleteButton } from "@/components/workspace/job-delete-button";
import { useLiveJobContext } from "@/components/workspace/live-job-provider";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { displayName } from "@/lib/jobs/display-name";
import { displayStatus, type DisplayStatus } from "@/lib/jobs/display-status";
import { useCreateDraft } from "@/lib/jobs/use-create-draft";
import type { Job } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";

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
 * The page's header band, the same shape as the draft wizard's: breadcrumb, the
 * simulation's own name with its status, the snapshot it is based on, and, once
 * the job has ended, "New from this model snapshot" and Delete. Nothing else is
 * an action here: Cancel and "Try again with these settings" live in the status
 * summary, where the job is.
 *
 * Render it inside a `LiveJobProvider`. A DRAFT has no header here: the draft
 * wizard has its own.
 */
export function JobHero({ job, preview = false }: { job: Job; preview?: boolean }) {
  const { status, view } = useLiveJobContext();
  const { pending, error, deriveFrom } = useCreateDraft();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteExpired, setDeleteExpired] = useState(false);

  const shown = displayStatus({ status, cancel_requested_at: view.cancel_requested_at });
  const ended = isTerminalStatus(status);
  const name = displayName(job);
  const meta = [name !== job.sim_id ? job.sim_id : null, job.slurm_job_id ? `Slurm #${job.slurm_job_id}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="bg-gradient-to-br from-hero to-primary px-4 pt-6 pb-7 sm:px-6 sm:pt-8 lg:px-10">
      <div className="mx-auto max-w-[1024px]">
        <nav aria-label="Breadcrumb" className="text-sm text-white/70">
          <ol className="flex min-w-0 items-center gap-1.5">
            <li className="shrink-0">
              <Link
                href="/workspace"
                className="rounded outline-none transition-colors hover:text-white focus-visible:ring-[3px] focus-visible:ring-white/70"
              >
                My Simulations
              </Link>
            </li>
            <li aria-hidden="true" className="shrink-0">
              <ChevronRight className="size-3.5" />
            </li>
            <li aria-current="page" className="min-w-0 truncate text-white">
              {name}
            </li>
          </ol>
        </nav>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="min-w-0 break-words text-2xl font-bold text-white">{name}</h1>
              {/* The badge's text is dark-on-tint, for a white card: give it one. */}
              <span className="shrink-0 rounded-full bg-white">
                <JobStatusBadge status={shown} />
              </span>
            </div>
            <p className="mt-2 min-w-0 text-sm">
              <Link
                href={`/repository/${job.dataset_id}`}
                title={`Based on ${job.dataset_title}`}
                className="block max-w-full truncate rounded text-white/90 underline-offset-2 outline-none transition-colors hover:text-white hover:underline focus-visible:ring-[3px] focus-visible:ring-white/70"
              >
                Based on {job.dataset_title}
              </Link>
            </p>
            {meta && <p className="mt-1 break-words font-mono text-xs text-white/60">{meta}</p>}
          </div>

          {ended && (
            <div className="flex shrink-0 flex-wrap items-center gap-3 sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => void deriveFrom(job.dataset_id)}
                className={`min-h-10 shrink-0 gap-2 font-semibold ${HERO_BUTTON.secondary}`}
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
          )}
        </div>

        {(deleteExpired || error?.kind === "session-expired") && (
          <SessionExpiredBanner className="mt-4 w-full sm:max-w-md" />
        )}
        {deleteError && (
          <div className="mt-4">
            <HeroError>{deleteError}</HeroError>
          </div>
        )}
        {error?.kind === "error" && (
          <div className="mt-4">
            <HeroError>{error.message}</HeroError>
          </div>
        )}
        <StatusAnnouncer status={shown} />
      </div>
    </div>
  );
}
