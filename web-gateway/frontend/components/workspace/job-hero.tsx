"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Ban, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JobStatusBadge, STATUS_LABEL } from "@/components/jobs/job-status-badge";
import { CancelJobDialog } from "@/components/workspace/cancel-job-dialog";
import { DeriveSimulationButton } from "@/components/workspace/derive-simulation-button";
import { HERO_BUTTON, HeroError } from "@/components/workspace/hero-button";
import { JobDeleteMenu } from "@/components/workspace/job-delete-menu";
import { useLiveJobContext } from "@/components/workspace/live-job-provider";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { displayStatus, type DisplayStatus } from "@/lib/jobs/display-status";
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

/** The dark band: what this is, where it came from, and the actions for its
 *  state. On a phone the actions stack under the title. */
function HeroFrame({
  job,
  status,
  announcer,
  children,
}: {
  job: Job;
  status: DisplayStatus;
  announcer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const name = job.sim_id || job.slurm_job_name || job.id.slice(0, 8);
  return (
    <div className="bg-gradient-to-r from-hero to-primary py-8">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-5 px-4 sm:flex-row sm:items-start sm:justify-between sm:px-10">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 break-words text-xl font-bold text-white md:text-2xl">
              {job.dataset_title}
            </h1>
            {/* The badge's text is dark-on-tint, for a white card: give it one. */}
            <span className="shrink-0 rounded-full bg-white">
              <JobStatusBadge status={status} />
            </span>
          </div>
          <p className="mt-1 break-words font-mono text-sm text-white/75">
            {name}
            {job.slurm_job_id ? ` · Slurm #${job.slurm_job_id}` : ""}
          </p>
          <p className="mt-2 text-sm">
            <Link
              href={`/repository/${job.dataset_id}`}
              className="rounded text-white/90 underline underline-offset-2 outline-none transition-colors hover:text-white focus-visible:ring-[3px] focus-visible:ring-white/70"
            >
              Base model snapshot: {job.dataset_title}
            </Link>
          </p>
        </div>
        <div className="w-full min-w-0 sm:w-auto sm:shrink-0">{children}</div>
        {announcer}
      </div>
    </div>
  );
}

/** What a failed or expired delete says, for the hero's notes. */
function useDeleteNotes() {
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  return {
    menuProps: {
      onOpen: () => {
        setError(null);
        setExpired(false);
      },
      onError: setError,
      onSessionExpired: () => setExpired(true),
    },
    notes: (
      <>
        {expired && <SessionExpiredBanner className="w-full sm:max-w-md" />}
        {error && <HeroError>{error}</HeroError>}
      </>
    ),
  };
}

/**
 * The status page's header, with the actions for the live status: Cancel while
 * the job is queued or running, "New from this snapshot" and Delete once it has
 * ended, and nothing in between (COMPLETING finishes by itself, and a cancel already asked for is
 * waiting on SLURM; the status panel says so). When the poll moves the status
 * on, the actions change with it, without a reload.
 *
 * Render it inside a `LiveJobProvider`. A DRAFT has no header here: the draft
 * wizard has its own.
 */
export function JobHero({ job, preview = false }: { job: Job; preview?: boolean }) {
  const { jobId, status, view, apply, refresh } = useLiveJobContext();
  const [cancelOpen, setCancelOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelExpired, setCancelExpired] = useState(false);
  const { menuProps, notes } = useDeleteNotes();

  const shown = displayStatus({ status, cancel_requested_at: view.cancel_requested_at });
  const ended = isTerminalStatus(status);
  const cancellable =
    (status === "PENDING" || status === "SUBMITTED" || status === "RUNNING") &&
    !view.cancel_requested_at;

  return (
    <HeroFrame job={job} status={shown} announcer={<StatusAnnouncer status={shown} />}>
      <div className="flex w-full min-w-0 flex-col gap-2 sm:items-end">
        <div className="flex items-center gap-2">
          {(cancellable || cancelPending) && (
            <Button
              ref={cancelRef}
              type="button"
              variant="outline"
              disabled={cancelPending}
              onClick={() => setCancelOpen(true)}
              className={`min-h-10 flex-1 font-semibold sm:flex-none ${HERO_BUTTON.danger}`}
            >
              {cancelPending ? (
                <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <Ban aria-hidden="true" />
              )}
              {cancelPending ? "Cancelling…" : "Cancel"}
            </Button>
          )}
          {ended && (
            <>
              <div className="flex-1 sm:flex-none">
                <DeriveSimulationButton
                  datasetId={job.dataset_id}
                  label="New from this model snapshot"
                  tone="hero"
                />
              </div>
              <JobDeleteMenu
                jobId={job.id}
                isDraft={false}
                workDir={view.work_dir ?? job.work_dir}
                remoteJobDir={job.remote_job_dir}
                files={view.files ?? job.files}
                preview={preview}
                {...menuProps}
              />
            </>
          )}
        </div>
        {cancelExpired && <SessionExpiredBanner className="w-full sm:max-w-md" />}
        {notes}
      </div>

      {!ended && (
        <CancelJobDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          jobId={jobId}
          preview={preview}
          onCancelled={(data) => {
            setCancelExpired(false);
            apply(data);
          }}
          onConflict={refresh}
          onSessionExpired={() => setCancelExpired(true)}
          onPendingChange={setCancelPending}
          // Back to the Cancel button; once a cancel went through the button
          // is gone and focus stays where Radix puts it.
          onCloseAutoFocus={(event) => {
            if (cancelRef.current) {
              event.preventDefault();
              cancelRef.current.focus();
            }
          }}
        />
      )}
    </HeroFrame>
  );
}
