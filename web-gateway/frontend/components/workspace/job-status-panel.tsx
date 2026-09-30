"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Clock,
  Send,
  Play,
  CheckCircle2,
  XCircle,
  Ban,
  Loader2,
  RefreshCw,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { TimeStamp } from "@/components/workspace/time-stamp";
import { useJobStatus } from "@/lib/workspace/use-job-status";
import { cancelJob } from "@/lib/jobs/actions";
import { displayStatus } from "@/lib/jobs/display-status";
import type { JobStatus, JobStatusResponse } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";

interface Props {
  jobId: string;
  initialStatus: JobStatus;
  initialData?: Partial<JobStatusResponse>;
  /** Rendering fixture data (see lib/workspace/preview.ts) — no real job
   *  behind `jobId`, so polling and cancelling would only hit the backend
   *  with an id it has never heard of. Freezes the panel on `initialData`
   *  and turns Cancel into a no-op explanation instead. */
  preview?: boolean;
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

export function JobStatusPanel({ jobId, initialStatus, initialData, preview = false }: Props) {
  const router = useRouter();
  const {
    view,
    status,
    slurmJobId,
    submittedAt,
    startedAt,
    completedAt,
    statusReason,
    cancelling,
    isPolling,
    sessionExpired: pollExpired,
    refresh,
    apply,
  } = useJobStatus(jobId, initialStatus, initialData, { disabled: preview });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [actionExpired, setActionExpired] = useState(false);
  const sessionExpired = pollExpired || actionExpired;

  // The cards beside this panel (queued, running, completed, failed,
  // cancelled) are chosen on the server from the status it rendered with.
  // When polling sees a different one, ask for the page again.
  const renderedStatus = useRef(initialStatus);
  useEffect(() => {
    if (preview || status === renderedStatus.current) return;
    renderedStatus.current = status;
    router.refresh();
  }, [status, preview, router]);

  const confirmCancel = async () => {
    if (cancelPending) return;
    if (preview) {
      setConfirmOpen(false);
      toast.info("Preview data — there is no real job to cancel.");
      return;
    }
    setCancelPending(true);
    try {
      const result = await cancelJob(jobId);
      setConfirmOpen(false);
      if (result.ok) {
        setActionExpired(false);
        apply(result.data);
        toast.success(
          isTerminalStatus(result.data.status)
            ? "Simulation cancelled."
            : "Cancel requested. SLURM will confirm shortly."
        );
      } else if (result.reason === "session_expired") {
        setActionExpired(true);
        toast.error("Your session has expired. Sign in to cancel this simulation.");
      } else if (result.reason === "not_found") {
        toast.error("This simulation no longer exists.");
      } else {
        toast.error(result.message || "Failed to cancel the simulation.");
        // A 409 means it is no longer cancellable, often because it just ended.
        if (result.status === 409) refresh();
      }
    } catch {
      setConfirmOpen(false);
      toast.error("Failed to cancel the simulation.");
    } finally {
      setCancelPending(false);
    }
  };

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

        {/* Polling indicator */}
        {isPolling && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 motion-safe:animate-spin" aria-hidden="true" />
            Checking status...
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {cancellable && (
            <AlertDialog
              open={confirmOpen}
              // Stay open while the request is in flight.
              onOpenChange={(next) => {
                if (!cancelPending) setConfirmOpen(next);
              }}
            >
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={showCancelling}
                  className="min-h-10 sm:min-h-8"
                >
                  {showCancelling ? (
                    <Loader2 className="mr-1.5 size-4 motion-safe:animate-spin" aria-hidden="true" />
                  ) : (
                    <Ban className="mr-1.5 size-4" aria-hidden="true" />
                  )}
                  {showCancelling ? "Cancelling…" : "Cancel Job"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this simulation?</AlertDialogTitle>
                  <AlertDialogDescription>
                    SLURM stops it; the work so far is kept until you delete it.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={cancelPending} className="min-h-10 sm:min-h-9">
                    Keep running
                  </AlertDialogCancel>
                  <AlertDialogAction
                    disabled={cancelPending}
                    className="min-h-10 bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/30 sm:min-h-9"
                    onClick={(event) => {
                      // Radix closes the dialog on Action; keep it open until
                      // the cancel has answered.
                      event.preventDefault();
                      void confirmCancel();
                    }}
                  >
                    {cancelPending ? (
                      <>
                        <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
                        Cancelling…
                      </>
                    ) : (
                      "Cancel simulation"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {!preview && !isTerminalStatus(status) && (
            <Button variant="ghost" size="sm" onClick={refresh} className="min-h-10 sm:min-h-8">
              <RefreshCw className="mr-1.5 size-4" aria-hidden="true" />
              Refresh
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
