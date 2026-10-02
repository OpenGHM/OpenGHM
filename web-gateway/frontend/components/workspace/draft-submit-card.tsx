"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Lock, Rocket, Send } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { DraftCard } from "@/components/workspace/draft-card";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { describeSubmitFailure, SubmitSummary } from "@/components/workspace/submit-summary";
import { effectiveCompute, type Recommended } from "@/lib/jobs/compute";
import type { ActionResult, Job, SubmitError } from "@/lib/jobs/types";
import type { SubmitProblem } from "@/lib/workspace/draft-state";
import { FIELD_LABELS } from "@/lib/workspace/draft-wizard";
import type { FlushResult } from "@/lib/workspace/use-draft-autosave";

/** `checking` is the short stretch after a submit whose answer never came: the
 *  card asks the server whether the job went out anyway. */
type Stage = "idle" | "flushing" | "confirming" | "submitting" | "checking" | "done";

/**
 * "Submit to Anvil" for the draft wizard's last step.
 *
 * Submit does not submit what is on screen: it saves first (`flush`), and the
 * confirmation shows what the server then holds, which is what will run. A save
 * that failed, or that left a value out (`withheld`), stops here with the reason.
 * Confirm stops auto-save (`suspend`) so that no PATCH can slip in after the save
 * the submit's claim is checked against, then calls `submit`.
 *
 * - `problems` is `submitProblems(...)`: while it is not empty the button is off
 *   and the list on the review step says why (a permission the user lacks is one
 *   of them).
 * - `lastSubmitError` is the stored reason the last submit did not reach Anvil,
 *   shown until a submit from here is confirmed: from then on only what this
 *   page's own attempt says is shown, and nothing at all once it succeeded.
 * - Success calls `onSubmitted(job)` and the card shows only "Submitted, opening
 *   the job page" while the wizard navigates. If the page never follows, the
 *   wizard sets `openJobHref` and the card offers a plain link to it instead.
 * - A submit whose answer never came (the request threw) is not necessarily a
 *   failure: `checkSubmitted` asks the server, and a job that is no longer a
 *   draft takes the success path. A failed submit calls `onSubmitFailed`: the
 *   draft is still a draft, but auto-save has been suspended for good, so the
 *   wizard has to load the job again and start over with it (a new `key`) before
 *   more can be saved.
 * - `onSubmittingChange(true)` is called at Confirm, not while saving, so the
 *   wizard may switch its inputs off without stopping the save.
 *
 * Everything with an effect is a prop, so this component calls no server action
 * and no router.
 */
export function DraftSubmitCard({
  jobId,
  problems,
  lastSubmitError,
  recommended,
  flush,
  suspend,
  submit,
  onSubmitted,
  onSubmitFailed,
  onSubmittingChange,
  checkSubmitted,
  openJobHref = null,
}: {
  jobId: string;
  problems: readonly SubmitProblem[];
  lastSubmitError: SubmitError | null;
  /** The snapshot's own `recommendedCompute`, for what an unset field means. */
  recommended: Recommended | null;
  flush: () => Promise<FlushResult>;
  suspend: () => void;
  submit: (jobId: string) => Promise<ActionResult<Job>>;
  onSubmitted: (job: Job) => void;
  onSubmitFailed?: () => void;
  onSubmittingChange?: (submitting: boolean) => void;
  /** After a submit that threw: the job as the server holds it now when it is no
   *  longer a draft (so the submit did go through), else null. */
  checkSubmitted?: (jobId: string) => Promise<Job | null>;
  /** Set by the wizard once a submit went through but its page did not change. */
  openJobHref?: string | null;
}) {
  const noteId = useId();
  const [stage, setStage] = useState<Stage>("idle");
  const [saved, setSaved] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  // Once Confirm was pressed the stored reason of an earlier submit is history.
  const [attempted, setAttempted] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const blocked = problems.length > 0;
  const quiet = stage === "submitting" || stage === "done";
  const shownError = quiet
    ? null
    : (error ??
      (lastSubmitError && !attempted ? `The last submit didn't go through: ${lastSubmitError.message}` : null));

  const start = async () => {
    if (stage !== "idle" || blocked) return;
    setStage("flushing");
    setError(null);
    setSessionExpired(false);
    let result: FlushResult;
    try {
      result = await flush();
    } catch {
      result = { ok: false };
    }
    if (!result.ok) {
      setError(
        "Your latest changes could not be saved, so nothing was submitted. Check the save status at the top of the page, then try again."
      );
      setStage("idle");
    } else if (result.withheld.length > 0) {
      setError(
        `These aren't saved, so nothing was submitted: ${result.withheld.map((f) => FIELD_LABELS[f]).join(", ")}. Fix them, then submit again.`
      );
      setStage("idle");
    } else {
      setSaved(result.job);
      setStage("confirming");
    }
  };

  const confirm = async () => {
    if (stage !== "confirming") return;
    setStage("submitting");
    setAttempted(true);
    setError(null);
    setSessionExpired(false);
    suspend();
    onSubmittingChange?.(true);

    let message: string | null = null;
    let thrown = false;
    try {
      const result = await submit(jobId);
      if (result.ok) {
        setStage("done");
        onSubmitted(result.data);
        return;
      }
      if (result.reason === "session_expired") setSessionExpired(true);
      else if (result.reason === "not_found") message = "This simulation no longer exists.";
      else message = describeSubmitFailure(result);
    } catch (err) {
      thrown = true;
      // A thrown error is the request itself failing (for example the 60 s
      // timeout), not an answer from the backend: say what is known.
      message =
        err instanceof Error
          ? `Could not confirm the submit: ${err.message}. Check My Simulations before trying again.`
          : "Could not confirm the submit. Check My Simulations before trying again.";
    }
    setError(message);
    if (thrown && checkSubmitted) {
      // The answer was lost, the submit may not have been: say what is known
      // above, then look. A job that left DRAFT went out.
      setStage("checking");
      let went: Job | null = null;
      try {
        went = await checkSubmitted(jobId);
      } catch {
        went = null;
      }
      if (!mounted.current) return;
      if (went) {
        setError(null);
        setStage("done");
        onSubmitted(went);
        return;
      }
    }
    setStage("idle");
    onSubmittingChange?.(false);
    onSubmitFailed?.();
  };

  const compute = saved ? effectiveCompute(saved.slurm_config, recommended) : null;

  const done = stage === "done";

  return (
    <DraftCard title="Submit" icon={Rocket}>
      {!done && (
        <p className="text-sm text-muted-foreground">
          Your draft saves automatically. Submitting runs it on Anvil and spends compute time.
        </p>
      )}

      {blocked && !done && (
        <p
          id={noteId}
          className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground"
        >
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {problems.length === 1
              ? "Fix the item under Needs attention to submit."
              : `Fix the ${problems.length} items under Needs attention to submit.`}
          </span>
        </p>
      )}

      {sessionExpired && !done && <SessionExpiredBanner />}

      {shownError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-status-failed"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 break-words">{shownError}</p>
        </div>
      )}

      {done ? (
        openJobHref ? (
          <div role="status" className="flex flex-col gap-3 text-sm">
            <p className="flex items-start gap-2 font-medium text-success">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              The submit went through but this page did not update.
            </p>
            <Button asChild className="min-h-10 w-full font-semibold">
              {/* A plain link on purpose: a full page load always shows the
                  server's current page, which is what is out of step here. */}
              <a href={openJobHref}>Open the job page</a>
            </Button>
          </div>
        ) : (
          <p role="status" className="flex items-center gap-2 text-sm font-medium text-success">
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            Submitted — opening the job page…
          </p>
        )
      ) : (
        <Button
          type="button"
          disabled={blocked || stage !== "idle"}
          aria-describedby={blocked ? noteId : undefined}
          onClick={() => void start()}
          className="min-h-10 w-full font-semibold"
        >
          {stage === "flushing" ? (
            <>
              <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
              Saving…
            </>
          ) : (
            <>
              <Send aria-hidden="true" />
              Submit to Anvil
            </>
          )}
        </Button>
      )}

      <AlertDialog
        open={stage === "confirming" || stage === "submitting"}
        // Stay open while the request is in flight: closing would hide the
        // only sign that something is happening.
        onOpenChange={(next) => {
          if (!next && stage === "confirming") setStage("idle");
        }}
      >
        {/* A long variable list makes the summary taller than a phone: scroll
            inside the dialog so Cancel and Submit stay reachable. */}
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Submit this simulation to Anvil?</AlertDialogTitle>
            <AlertDialogDescription>
              This starts the run and spends compute time. Check the summary first.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {saved && compute && (
            <SubmitSummary
              snapshotTitle={saved.dataset_title}
              start={saved.parameters.temporal_range_start}
              end={saved.parameters.temporal_range_end}
              variables={saved.parameters.variables}
              cores={compute.cores}
              coresFromSnapshot={compute.coresSource === "snapshot"}
              walltime={compute.walltime}
              walltimeFromSnapshot={compute.walltimeSource === "snapshot"}
              walltimeCapped={compute.walltimeCapped}
            />
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={stage === "submitting"} className="min-h-10 sm:min-h-9">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={stage === "submitting"}
              className="min-h-10 sm:min-h-9"
              onClick={(event) => {
                // Radix closes the dialog on Action; keep it open until the
                // submit has answered.
                event.preventDefault();
                void confirm();
              }}
            >
              {stage === "submitting" ? (
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
    </DraftCard>
  );
}
