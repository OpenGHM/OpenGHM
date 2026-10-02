"use client";

import { useRef, useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  Ban,
  CheckCircle2,
  CloudOff,
  Hourglass,
  Loader2,
  Radio,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimeStamp } from "@/components/common/time-stamp";
import { CancelJobDialog } from "@/components/workspace/cancel-job-dialog";
import { CompletedResults } from "@/components/workspace/completed-results";
import { DuplicateSimulationButton } from "@/components/workspace/duplicate-simulation-button";
import { ExcerptBlock } from "@/components/workspace/excerpt-block";
import { FailedDetails } from "@/components/workspace/failed-details";
import { JobTimeline } from "@/components/workspace/job-timeline";
import { useLiveJobContext } from "@/components/workspace/live-job-provider";
import { RunMetadata } from "@/components/workspace/run-metadata";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { displayStatus, type DisplayStatus } from "@/lib/jobs/display-status";
import { HUE, TONE_HUE } from "@/lib/jobs/status-hue";
import { isTerminalStatus, type Job } from "@/lib/jobs/types";
import { cancelledBy } from "@/lib/workspace/cancelled-by";
import { FAILURE_COPY, UNRECORDED_FAILURE_COPY } from "@/lib/workspace/failure-copy";
import { describeQueueReason } from "@/lib/workspace/queue-reason";
import {
  describeProgress,
  elapsedSeconds,
  walltimeUsed,
  type WalltimeTone,
} from "@/lib/workspace/run-progress";
import { shortDuration, secondsBetween } from "@/lib/workspace/timeline";
import { formatAge, formatDuration, formatLocalDateTime, formatUtcDateTime } from "@/lib/workspace/time";
import { useNow } from "@/lib/workspace/use-now";

const TONE_BAR: Record<WalltimeTone, string> = {
  normal: "bg-muted-foreground/50",
  warning: "bg-status-running",
  critical: "bg-status-failed",
};

const FAILURE_ICON = { danger: AlertOctagon, warning: AlertTriangle, neutral: CloudOff } as const;

function Bar({
  percent,
  label,
  valueText,
  barClass,
  thin = false,
}: {
  percent: number;
  label: string;
  valueText: string;
  barClass: string;
  thin?: boolean;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      aria-valuetext={valueText}
      className={`w-full overflow-hidden rounded-full bg-muted ${thin ? "h-1.5" : "h-2.5"}`}
    >
      <div
        className={`h-full rounded-full ${barClass} motion-safe:transition-[width]`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/**
 * RUNNING/COMPLETING — how far WBM has simulated and how much of the walltime
 * is used (ADR 0027). The walltime bar is an upper bound on the wait, not work
 * done, and is drawn thin and captioned as that; the simulation bar is drawn
 * only when WBM's own log gives a fraction.
 */
function RunningBody() {
  const { live, view } = useLiveJobContext();
  const now = useNow(1_000);

  const limit = live?.time_limit_seconds ?? null;
  const start = view.slurm_start ?? view.started_at;
  // Before hydration there is no clock: print what does not depend on it.
  const elapsed = now === null ? null : elapsedSeconds(start, now);
  const used = elapsed === null ? null : walltimeUsed(elapsed, limit);
  const words = describeProgress(live?.progress ?? null);

  const elapsedText =
    elapsed === null
      ? null
      : limit
        ? `Elapsed ${formatDuration(elapsed)} of ${formatDuration(limit, { withSeconds: false })} walltime`
        : `Elapsed ${formatDuration(elapsed)}`;

  return (
    <div className="mt-5 space-y-4">
      <div className="space-y-2">
        {live?.progress ? (
          <>
            <p className="break-words text-sm font-medium text-foreground">{words.headline}</p>
            {words.percent !== null && (
              <Bar
                percent={words.percent}
                label="Simulation progress"
                valueText={words.headline}
                barClass="bg-primary"
              />
            )}
            {words.note && <p className="text-xs text-muted-foreground">{words.note}</p>}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{words.note}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <p className="text-sm text-muted-foreground">
          {elapsedText ?? (limit ? `${formatDuration(limit, { withSeconds: false })} walltime` : "Running.")}
        </p>
        {limit ? (
          <Bar
            thin
            percent={used?.percent ?? 0}
            label="Walltime used"
            valueText={elapsedText ?? "Not yet measured"}
            barClass={TONE_BAR[used?.tone ?? "normal"]}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * How fresh what is on screen is: when SLURM last answered, counted up each
 * second in the browser only; or, after a failed poll, when the next try is.
 * Not a live region: it changes every second and would be read out each time.
 */
function FreshnessLine({ preview }: { preview: boolean }) {
  const { status, live, lastSuccessAt, lastError, retryInSeconds, refresh, sessionExpired } =
    useLiveJobContext();
  const now = useNow(1_000);

  if (isTerminalStatus(status) || sessionExpired) return null;

  if (lastError !== null) {
    return (
      <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <WifiOff className="size-3.5 shrink-0 text-status-cancelling" aria-hidden="true" />
        <span>
          {lastError} — retrying in {retryInSeconds ?? 0} s
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={refresh}
          className="min-h-10 px-3 text-xs sm:min-h-8"
        >
          <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
          Retry now
        </Button>
      </div>
    );
  }

  // SLURM's own timestamp when it gave one, else when the gateway last heard.
  const checkedIso = live?.checked_at ?? (lastSuccessAt ? new Date(lastSuccessAt).toISOString() : null);
  const hydrated = now !== null;
  const checkedMs = checkedIso ? new Date(checkedIso).getTime() : 0;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Radio className="size-3.5" aria-hidden="true" />
        {checkedIso === null ? (
          "Checking with SLURM…"
        ) : (
          <span>
            Checked with SLURM{" "}
            <time
              dateTime={checkedIso}
              title={hydrated ? formatLocalDateTime(checkedIso) : formatUtcDateTime(checkedIso)}
            >
              {hydrated ? formatAge(now - checkedMs) : formatUtcDateTime(checkedIso)}
            </time>
          </span>
        )}
      </span>
      {!preview && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={refresh}
          className="-my-1 min-h-10 px-2 text-xs sm:min-h-8"
        >
          <RefreshCw className="mr-1 size-3.5" aria-hidden="true" />
          Refresh
        </Button>
      )}
    </div>
  );
}

/** What the headline says, per status: the icon, the line, and the sentence under it. */
function useHeadline(job: Job, viewerEmail: string | null, shown: DisplayStatus) {
  const { view, live, submittedAt, startedAt, completedAt, statusReason } = useLiveJobContext();
  const failure = view.failure ?? job.failure;

  switch (shown) {
    case "PENDING":
    case "SUBMITTED":
      return {
        Icon: Hourglass,
        title: "In the queue",
        sub: (
          <>
            {describeQueueReason(live?.queue_reason ?? null)}
            {live && (
              <span className="ml-2 font-mono text-xs">SLURM: {live.queue_reason ?? "no reason given"}</span>
            )}
            {live?.estimated_start && (
              <>
                {" "}
                SLURM&apos;s estimate:{" "}
                <TimeStamp value={live.estimated_start} format="relative" />.
              </>
            )}
          </>
        ),
      };
    case "RUNNING":
      return { Icon: Loader2, title: "Running", sub: null };
    case "COMPLETING":
      return { Icon: Loader2, title: "Completing", sub: "SLURM is finishing the job." };
    case "CANCELLING":
      return {
        Icon: Ban,
        title: "Cancelling",
        sub: "SLURM has been asked to stop this simulation. It stays Cancelling until SLURM confirms.",
      };
    case "COMPLETED": {
      const ran = secondsBetween(view.slurm_start ?? startedAt, view.slurm_end ?? completedAt);
      return { Icon: CheckCircle2, title: ran === null ? "Completed" : `Completed in ${shortDuration(ran)}`, sub: null };
    }
    case "FAILED": {
      const copy = failure ? FAILURE_COPY[failure.cause] : UNRECORDED_FAILURE_COPY;
      // The backend's message is the specific one. Without a verdict, the
      // reason the job stored; without either, the per-cause body.
      const message = (failure ? failure.message : (statusReason ?? job.status_reason)) || copy.body;
      return { Icon: FAILURE_ICON[copy.tone], title: copy.title, sub: message };
    }
    case "CANCELLED": {
      const when = job.cancel_requested_at ?? view.slurm_end ?? completedAt;
      return {
        Icon: Ban,
        title: "Cancelled",
        sub: (
          <>
            {cancelledBy({ ...job, ...view, failure }, viewerEmail)}
            {when && (
              <>
                {" "}
                <TimeStamp value={when} format="relative" />
              </>
            )}
            .
          </>
        ),
      };
    }
    default:
      return { Icon: Hourglass, title: submittedAt ? "Submitted" : "Draft", sub: null };
  }
}

/**
 * The page's answer to "what is it doing, did it work, where is the result":
 * one full-width card that changes with the live status. Queued and running
 * jobs show where they are and offer Cancel; a completed one shows its
 * results; a failed one its cause, the log excerpt and the way to try again; a
 * cancelled one who stopped it. Colour is the status's alone.
 *
 * Cancelling lives here (and Delete in the header menu): one home for each
 * action. The header's live region announces a change of status; this card
 * does not.
 */
export function JobStatusSummary({
  job,
  viewerEmail,
  preview = false,
}: {
  job: Job;
  viewerEmail: string | null;
  preview?: boolean;
}) {
  const { jobId, status, view, apply, refresh, sessionExpired, statusReason } = useLiveJobContext();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelExpired, setCancelExpired] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const shown = displayStatus({ status, cancel_requested_at: view.cancel_requested_at });
  const headline = useHeadline(job, viewerEmail, shown);
  const failure = view.failure ?? job.failure;
  const failureCopy = failure ? FAILURE_COPY[failure.cause] : UNRECORDED_FAILURE_COPY;
  // A failed run reads amber when it hit a limit, grey when it was not its
  // owner's doing, and red otherwise.
  const hue = HUE[shown === "FAILED" ? TONE_HUE[failureCopy.tone] : shown];
  const active = !isTerminalStatus(status);
  const cancellable =
    (status === "PENDING" || status === "SUBMITTED" || status === "RUNNING") && !view.cancel_requested_at;

  // What the verdict knows, from the poll once it has moved on and else from
  // the page's own copy of the job.
  const merged: Job = {
    ...job,
    failure: view.failure ?? job.failure,
    slurm_state: view.slurm_state ?? job.slurm_state,
    slurm_exit_code: view.slurm_exit_code ?? job.slurm_exit_code,
  };
  const { Icon } = headline;
  const spinning = shown === "RUNNING" || shown === "COMPLETING";
  // A reason for a job that is neither failed nor over, when SLURM or the gateway gave one.
  const showReason = Boolean(statusReason) && active;

  return (
    <section
      aria-label="Status"
      className={`rounded-xl border border-l-4 bg-card p-5 shadow-sm sm:p-6 ${hue.border}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2.5 text-xl font-semibold text-foreground">
            <Icon
              className={`size-5 shrink-0 ${hue.icon} ${spinning ? "motion-safe:animate-spin" : ""}`}
              aria-hidden="true"
            />
            <span className="min-w-0 break-words">{headline.title}</span>
          </h2>
          {headline.sub && (
            <p className="mt-1.5 min-w-0 break-words text-sm text-muted-foreground">{headline.sub}</p>
          )}
        </div>
        {(cancellable || cancelPending) && (
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            disabled={cancelPending}
            onClick={() => setCancelOpen(true)}
            className="min-h-10 shrink-0 gap-2 border-destructive/30 font-semibold text-destructive hover:bg-destructive/5 hover:text-destructive"
          >
            {cancelPending ? (
              <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <Ban aria-hidden="true" />
            )}
            {cancelPending ? "Cancelling…" : "Cancel"}
          </Button>
        )}
      </div>

      <JobTimeline className="mt-3" />

      {showReason && <p className="mt-3 break-words text-sm text-muted-foreground">{statusReason}</p>}

      {(shown === "RUNNING" || shown === "COMPLETING") && <RunningBody />}

      {shown === "COMPLETED" && (
        <CompletedResults
          workDir={view.work_dir ?? job.work_dir}
          completedAt={view.completed_at ?? job.completed_at}
          output={view.output ?? job.output}
          files={view.files ?? job.files}
        />
      )}

      {shown === "FAILED" && (
        <FailedDetails job={merged} copy={failureCopy} />
      )}

      {shown === "CANCELLED" && (
        <div className="mt-4 space-y-4">
          <RunMetadata job={merged} phase={merged.failure?.phase} />
          {merged.failure?.excerpt && <ExcerptBlock excerpt={merged.failure.excerpt} />}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 text-sm text-muted-foreground">
              {(view.files ?? job.files) !== "purged" &&
                "Any files it wrote stay on Anvil until you delete this simulation or Anvil's 30-day purge removes them."}
            </p>
            <DuplicateSimulationButton jobId={job.id} variant="outline" />
          </div>
        </div>
      )}

      {(sessionExpired || cancelExpired) && <SessionExpiredBanner className="mt-4" />}

      <FreshnessLine preview={preview} />

      {active && (
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
    </section>
  );
}
