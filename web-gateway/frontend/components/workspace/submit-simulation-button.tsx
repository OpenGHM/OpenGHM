"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Lock, Send } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HERO_BUTTON, HeroError } from "@/components/workspace/hero-button";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { describeSubmitFailure, SubmitSummary } from "@/components/workspace/submit-summary";
import { effectiveCompute, type Recommended } from "@/lib/jobs/compute";
import { submitSimulation } from "@/lib/jobs/actions";
import type { Job } from "@/lib/jobs/types";

/**
 * "Submit to Anvil" for a DRAFT, in the page header: a confirmation that says
 * what will run and what it spends, then `POST /jobs/{id}/submit`. It submits
 * what is saved, not what is typed in the editor below (the draft card says so).
 *
 * `blockedReason` is why this user cannot submit (ADR 0024), or null. The
 * button is then disabled, and the reason is both a tooltip on it and small
 * text under it, so it reaches a phone and a keyboard too. The backend checks
 * all of it again. A failed submit leaves its reason under the button as well
 * as in a toast.
 *
 * `trailing` is a control that sits beside the button (the More menu) and
 * `extraNotes` whatever that control has to say, so the notes go under both.
 */
export function SubmitSimulationButton({
  job,
  recommended,
  blockedReason,
  trailing,
  extraNotes,
}: {
  job: Job;
  /** The snapshot's own `recommendedCompute`, for what an unset field means. */
  recommended: Recommended | null;
  blockedReason: string | null;
  trailing?: React.ReactNode;
  extraNotes?: React.ReactNode;
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

  const button = (
    <Button
      type="button"
      disabled={blockedReason !== null}
      aria-describedby={blockedReason ? noteId : undefined}
      // Beside the More menu, the button takes the row's width on a phone. In
      // the tooltip's span it fills the span, which does that instead.
      className={`min-h-10 font-semibold ${HERO_BUTTON.primary} ${
        blockedReason ? "w-full sm:w-auto" : "flex-1 sm:flex-none"
      }`}
    >
      <Send aria-hidden="true" />
      Submit to Anvil
    </Button>
  );

  return (
    <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:items-end">
      <div className="flex items-center gap-2">
        <AlertDialog
          open={open}
          // Stay open while the request is in flight: closing would hide the
          // only sign that something is happening.
          onOpenChange={(next) => {
            if (!pending) setOpen(next);
          }}
        >
          {blockedReason ? (
            // A disabled button gets no pointer or focus events, so the
            // tooltip hangs on a focusable span around it.
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="min-w-0 flex-1 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-white/70 sm:flex-none"
                >
                  {button}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">{blockedReason}</TooltipContent>
            </Tooltip>
          ) : (
            <AlertDialogTrigger asChild>{button}</AlertDialogTrigger>
          )}
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
                    <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
                    Submitting…
                  </>
                ) : (
                  "Submit to Anvil"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {trailing}
      </div>

      {blockedReason && (
        <p id={noteId} className="flex items-start gap-1.5 text-xs text-white/80 sm:max-w-xs sm:text-right">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{blockedReason}</span>
        </p>
      )}

      {sessionExpired && <SessionExpiredBanner className="w-full sm:max-w-md" />}

      {shownError && <HeroError>{shownError}</HeroError>}

      {extraNotes}
    </div>
  );
}
