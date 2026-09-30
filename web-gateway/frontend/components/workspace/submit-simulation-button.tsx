"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, Loader2, Lock, Rocket, Send } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { describeSubmitFailure, SubmitSummary } from "@/components/workspace/submit-summary";
import { effectiveCompute, type Recommended } from "@/lib/jobs/compute";
import { submitSimulation } from "@/lib/jobs/actions";
import type { Job } from "@/lib/jobs/types";

/**
 * "Submit to Anvil" for a DRAFT: a confirmation that says what will run and
 * what it spends, then `POST /jobs/{id}/submit`. It submits what is saved, not
 * what is typed in the editor next to it (said in the card).
 *
 * `blockedReason` is why this user cannot submit (ADR 0024), or null. The
 * button is then disabled and the reason sits beside it, in plain text
 * rather than a tooltip. The backend checks all of it again.
 */
export function SubmitSimulationButton({
  job,
  recommended,
  blockedReason,
}: {
  job: Job;
  /** The snapshot's own `recommendedCompute`, for what an unset field means. */
  recommended: Recommended | null;
  blockedReason: string | null;
}) {
  const router = useRouter();
  const noteId = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const compute = effectiveCompute(job.slurm_config, recommended);
  const { temporal_range_start: start, temporal_range_end: end, variables } = job.parameters;
  // The last submit that did not reach SLURM, from the job itself, until a
  // submit in this page replaces it.
  const shownError = error ?? job.last_submit_error?.message ?? null;

  const confirm = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    setSessionExpired(false);
    try {
      const result = await submitSimulation(job.id);
      if (result.ok) {
        setOpen(false);
        toast.success("Submitted to Anvil.");
        router.refresh();
        return;
      }
      setOpen(false);
      if (result.reason === "session_expired") {
        setSessionExpired(true);
        toast.error("Your session has expired.");
      } else if (result.reason === "not_found") {
        setError("This simulation no longer exists.");
        toast.error("This simulation no longer exists.");
      } else {
        const message = describeSubmitFailure(result);
        setError(message);
        toast.error(message);
      }
    } catch (err) {
      // A thrown error here is the request itself failing (for example the
      // 60 s timeout), not an answer from the backend: say what is known.
      const message =
        err instanceof Error
          ? `Could not confirm the submit: ${err.message}. Check My Simulations before trying again.`
          : "Could not confirm the submit. Check My Simulations before trying again.";
      setOpen(false);
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-r from-primary/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
            <Rocket className="size-4 text-primary" aria-hidden="true" />
          </div>
          Run on Anvil
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5 pb-6">
        <p className="text-sm text-muted-foreground">
          Submitting sends this simulation to Anvil&apos;s queue. It runs the last saved
          version, so save your changes first. Nothing runs until you confirm.
        </p>

        {sessionExpired && <SessionExpiredBanner />}

        {shownError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-status-failed"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{shownError}</p>
          </div>
        )}

        {blockedReason && (
          <div
            id={noteId}
            className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground"
          >
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{blockedReason}</p>
          </div>
        )}

        <AlertDialog
          open={open}
          // Stay open while the request is in flight: closing would hide the
          // only sign that something is happening.
          onOpenChange={(next) => {
            if (!pending) setOpen(next);
          }}
        >
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              disabled={blockedReason !== null}
              aria-describedby={blockedReason ? noteId : undefined}
              className="min-h-10 w-full font-semibold"
            >
              <Send aria-hidden="true" />
              Submit to Anvil
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Submit this simulation to Anvil?</AlertDialogTitle>
              <AlertDialogDescription>
                This starts the run and spends compute time. Check the summary first.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <SubmitSummary
              snapshotTitle={job.dataset_title}
              start={start}
              end={end}
              variables={variables}
              cores={compute.cores}
              coresFromSnapshot={compute.coresSource === "snapshot"}
              walltime={compute.walltime}
              walltimeFromSnapshot={compute.walltimeSource === "snapshot"}
            />

            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending} className="min-h-10 sm:min-h-9">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={pending}
                className="min-h-10 sm:min-h-9"
                onClick={(event) => {
                  // Radix closes the dialog on Action; keep it open until
                  // the submit has answered.
                  event.preventDefault();
                  void confirm();
                }}
              >
                {pending ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    Submitting…
                  </>
                ) : (
                  "Submit to Anvil"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
