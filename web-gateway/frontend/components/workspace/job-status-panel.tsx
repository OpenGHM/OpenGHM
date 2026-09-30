"use client";

import { useState } from "react";
import {
  Clock,
  Send,
  Play,
  CheckCircle2,
  XCircle,
  Ban,
  Loader2,
  RefreshCw,
  Radio,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { CancelJobDialog } from "@/components/workspace/cancel-job-dialog";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { TimeStamp } from "@/components/workspace/time-stamp";
import { useLiveJobContext } from "@/components/workspace/live-job-provider";
import { formatAge, formatLocalDateTime, formatUtcDateTime } from "@/lib/workspace/time";
import { useNow } from "@/lib/workspace/use-now";
import { displayStatus } from "@/lib/jobs/display-status";
import { isTerminalStatus } from "@/lib/jobs/types";

interface Props {
  /** Rendering fixture data (see lib/workspace/preview.ts) — no real job
   *  behind the page, so cancelling would only hit the backend with an id it
   *  has never heard of. Turns Cancel into a no-op explanation. (Polling is
   *  stopped by the provider.) */
  preview?: boolean;
}

/**
 * How fresh what is on screen is: when SLURM last answered, counted up each
 * second in the browser only; or, after a failed poll, when the next try is.
 * Not a live region: it changes every second and would be read out each time.
 */
function FreshnessLine() {
  const { status, live, lastSuccessAt, lastError, retryInSeconds, refresh, sessionExpired } =
    useLiveJobContext();
  const now = useNow(1_000);

  if (isTerminalStatus(status) || sessionExpired) return null;

  if (lastError !== null) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
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
  if (checkedIso === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Radio className="size-3.5" aria-hidden="true" />
        Checking with SLURM…
      </div>
    );
  }
  const checkedMs = new Date(checkedIso).getTime();
  const hydrated = now !== null;
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Radio className="size-3.5" aria-hidden="true" />
      <span>
        Checked with SLURM{" "}
        <time
          dateTime={checkedIso}
          title={hydrated ? formatLocalDateTime(checkedIso) : formatUtcDateTime(checkedIso)}
        >
          {hydrated ? formatAge(now - checkedMs) : formatUtcDateTime(checkedIso)}
        </time>
      </span>
    </div>
  );
}

function TimelineRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      <TimeStamp value={value} className="min-w-0 font-medium text-foreground" />
    </div>
  );
}

export function JobStatusPanel({ preview = false }: Props) {
  const {
    jobId,
    view,
    status,
    slurmJobId,
    submittedAt,
    startedAt,
    completedAt,
    statusReason,
    cancelling,
    lastError,
    sessionExpired: pollExpired,
    refresh,
    apply,
  } = useLiveJobContext();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [actionExpired, setActionExpired] = useState(false);
  const sessionExpired = pollExpired || actionExpired;

  const cancellable =
    !isTerminalStatus(status) && status !== "DRAFT" && status !== "COMPLETING";
  const showCancelling = cancelling || cancelPending;
  const shown = displayStatus({ status, cancel_requested_at: view.cancel_requested_at });
  // A FAILED job with a recorded cause is explained by its card; this is the
  // fallback for one without.
  const showReason = Boolean(statusReason) && (status === "FAILED" ? !view.failure : !isTerminalStatus(status));

  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-r from-primary/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
            <Play className="size-4 text-primary" aria-hidden="true" />
          </div>
          Job Status
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5 pt-5 pb-6">
        {/* Status badge + Slurm ID. A live region, so a change to Cancelled,
            Failed or Completed is announced without moving focus. */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div role="status" aria-live="polite" aria-atomic="true">
              <span className="sr-only">Simulation status: </span>
              <JobStatusBadge status={shown} />
            </div>
            {slurmJobId && (
              <span className="text-xs text-muted-foreground">
                Slurm #{slurmJobId}
              </span>
            )}
          </div>
          {shown === "CANCELLING" && (
            <p className="text-xs text-muted-foreground">
              SLURM has been asked to stop this simulation. It stays
              Cancelling until SLURM confirms.
            </p>
          )}
        </div>

        {/* Timeline */}
        <div className="space-y-2">
          <TimelineRow
            icon={<Clock className="size-3.5" aria-hidden="true" />}
            label="Submitted"
            value={submittedAt}
          />
          <TimelineRow
            icon={<Send className="size-3.5" aria-hidden="true" />}
            label="Started"
            value={startedAt}
          />
          <TimelineRow
            icon={<Ban className="size-3.5" aria-hidden="true" />}
            label="Cancel requested"
            value={view.cancel_requested_at}
          />
          <TimelineRow
            icon={<CheckCircle2 className="size-3.5" aria-hidden="true" />}
            label="Ended"
            value={completedAt}
          />
        </div>

        {/* Status reason, when nothing more specific explains it */}
        {showReason && (
          <div
            className={`rounded-lg border p-3 text-sm ${
              status === "FAILED"
                ? "border-status-failed/25 bg-status-failed/5 text-status-failed"
                : "bg-muted/50 text-muted-foreground"
            }`}
          >
            <div className="flex items-start gap-2">
              <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{statusReason}</span>
            </div>
          </div>
        )}

        {sessionExpired && <SessionExpiredBanner />}

        <FreshnessLine />

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {cancellable && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={showCancelling}
              onClick={() => setConfirmOpen(true)}
              className="min-h-10 sm:min-h-8"
            >
              {showCancelling ? (
                <Loader2 className="mr-1.5 size-4 motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <Ban className="mr-1.5 size-4" aria-hidden="true" />
              )}
              {showCancelling ? "Cancelling…" : "Cancel Job"}
            </Button>
          )}
          {!preview && !isTerminalStatus(status) && lastError === null && (
            <Button variant="ghost" size="sm" onClick={refresh} className="min-h-10 sm:min-h-8">
              <RefreshCw className="mr-1.5 size-4" aria-hidden="true" />
              Refresh
            </Button>
          )}
        </div>

        <CancelJobDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          jobId={jobId}
          preview={preview}
          onCancelled={(data) => {
            setActionExpired(false);
            apply(data);
          }}
          onConflict={refresh}
          onSessionExpired={() => setActionExpired(true)}
          onPendingChange={setCancelPending}
        />
      </CardContent>
    </Card>
  );
}
