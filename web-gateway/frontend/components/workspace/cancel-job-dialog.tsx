"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cancelJob } from "@/lib/jobs/actions";
import type { JobStatusResponse } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";

/**
 * The confirmation before a cancel (ADR 0026), controlled so that any control
 * can open it: the status summary's button. It owns the request and its toasts
 * and reports the outcome to the caller, which is the one that knows what to
 * refresh.
 *
 * It stays open while the request is in flight: closing would hide the only
 * sign that something is happening.
 */
export function CancelJobDialog({
  open,
  onOpenChange,
  jobId,
  preview = false,
  onCancelled,
  onConflict,
  onSessionExpired,
  onPendingChange,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  /** Fixture data: there is no real job behind `jobId`. */
  preview?: boolean;
  /** The backend accepted the cancel; `data` is the job's new status. */
  onCancelled: (data: JobStatusResponse) => void;
  /** A 409: the job can no longer be cancelled, often because it just ended.
   *  The caller should look again. */
  onConflict?: () => void;
  /** The session ended; the caller shows the sign-in banner. */
  onSessionExpired?: () => void;
  /** The request started or ended, for a caller that shows it elsewhere. */
  onPendingChange?: (pending: boolean) => void;
  /** Where focus goes when the dialog closes. Opened without a trigger, Radix
   *  would leave it on the body; the caller hands it back to its button. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [pending, setPending] = useState(false);

  const setBusy = (next: boolean) => {
    setPending(next);
    onPendingChange?.(next);
  };

  const confirm = async () => {
    if (pending) return;
    if (preview) {
      onOpenChange(false);
      toast.info("Preview data — there is no real job to cancel.");
      return;
    }
    setBusy(true);
    try {
      const result = await cancelJob(jobId);
      onOpenChange(false);
      if (result.ok) {
        onCancelled(result.data);
        toast.success(
          isTerminalStatus(result.data.status)
            ? "Simulation cancelled."
            : "Cancel requested. SLURM will confirm shortly."
        );
      } else if (result.reason === "session_expired") {
        onSessionExpired?.();
        toast.error("Your session has expired. Sign in to cancel this simulation.");
      } else if (result.reason === "not_found") {
        toast.error("This simulation no longer exists.");
      } else {
        toast.error(result.message || "Failed to cancel the simulation.");
        if (result.status === 409) onConflict?.();
      }
    } catch {
      onOpenChange(false);
      toast.error("Failed to cancel the simulation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this simulation?</AlertDialogTitle>
          <AlertDialogDescription>
            SLURM stops it; the work so far is kept until you delete it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className="min-h-10 sm:min-h-9">
            Keep running
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className="min-h-10 bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/30 sm:min-h-9"
            onClick={(event) => {
              // Radix closes the dialog on Action; keep it open until the
              // cancel has answered.
              event.preventDefault();
              void confirm();
            }}
          >
            {pending ? (
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
  );
}
