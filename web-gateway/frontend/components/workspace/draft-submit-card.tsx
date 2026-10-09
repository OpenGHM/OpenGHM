"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Loader2, RotateCw, Send, TriangleAlert } from "lucide-react";
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
import { DraftSection } from "@/components/workspace/draft-section";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { describeSubmitFailure, SubmitSummary } from "@/components/workspace/submit-summary";
import {
  describeCoresBelowRecommended,
  effectiveCompute,
  runsClimatology,
  type Recommended,
} from "@/lib/jobs/compute";
import type { ActionResult, Job, PostProcessingChoice, SubmitError } from "@/lib/jobs/types";
import type { DraftField, SubmitProblem } from "@/lib/workspace/draft-state";
import { FIELD_LABELS, type DraftStep } from "@/lib/workspace/draft-wizard";
import type { FlushResult } from "@/lib/workspace/use-draft-saver";

/** `checking` is the short stretch after a submit whose answer never came: the
 *  card asks the server whether the job went out anyway. */
type Stage = "idle" | "flushing" | "confirming" | "submitting" | "checking" | "done";

/**
 * The submit area of the draft wizard's last step: what stands in the way (each
 * problem with a link that takes you to its field), and "Submit to Anvil".
 *
 * Submit does not submit what is on screen: it saves first (`flush`), and the
 * confirmation shows what the server then holds, which is what will run. A save
 * that failed, or that left a value out (`withheld`), stops here with the reason.
 * Confirm stops saving (`suspend`) so that no PATCH can slip in after the save
 * the submit's claim is checked against, then calls `submit`.
 *
 * - `problems` is `submitProblems(...)`: while it is not empty the button is off
 *   and the list above it says why (a permission the user lacks is one of
 *   them). A problem with a field has a link, which calls `onFix(step, field)`;
 *   this is the only place the problems are listed.
 * - `lastSubmitError` is the stored reason the last submit did not reach Anvil,
 *   shown until a submit from here is confirmed: from then on only what this
 *   page's own attempt says is shown, and nothing at all once it succeeded.
 * - Success calls `onSubmitted(job)` and the card shows only "Submitted, opening
 *   the job page" while the wizard navigates. If the page never follows, the
 *   wizard sets `openJobHref` and the card offers a plain link to it instead.
 * - A submit whose answer never came (the request threw) is not necessarily a
 *   failure: `checkSubmitted` asks the server, and a job that is no longer a
 *   draft takes the success path. A failed submit calls `onSubmitFailed`: the
 *   draft is still a draft, but saving has been suspended, so the
 *   wizard resumes it and reads the stored failure.
 * - `onSubmittingChange(true)` is called at Confirm, not while saving, so the
 *   wizard may switch its inputs off without stopping the save.
 *
 * - `rerun` is the card for a draft the snapshot's published results already
 *   answer (the Review step shows those above it): the same save-confirm-submit
 *   path, but quiet, a secondary "Run anyway" under a warning line, and a
 *   confirmation, with a warning icon, that says it repeats a published result
 *   and uses allocation. The wizard passes a `submit`
 *   that asks the backend for a rerun.
 *
 * Everything with an effect is a prop, so this component calls no server action
 * and no router.
 */
export function DraftSubmitCard({
  jobId,
  problems,
  onFix,
  lastSubmitError,
  recommended,
  snapshotOutput = "standard",
  flush,
  suspend,
  submit,
  onSubmitted,
  onSubmitFailed,
  onSubmittingChange,
  checkSubmitted,
  openJobHref = null,
  rerun = false,
}: {
  jobId: string;
  problems: readonly SubmitProblem[];
  /** Take the person to the field a problem is about. */
  onFix: (step: DraftStep, field?: DraftField) => void;
  lastSubmitError: SubmitError | null;
  /** The snapshot's own `recommendedCompute`, for what an unset field means. */
  recommended: Recommended | null;
  /** What the snapshot computes on its own (`snapshotOutput`), for a draft with no choice. */
  snapshotOutput?: PostProcessingChoice;
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
  /** A rerun of results that are already published (see above). */
  rerun?: boolean;
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
      else if (result.reason === "not_found") message = "This snapshot draft no longer exists.";
      else {
        message = describeSubmitFailure(result);
        // No answer within the timeout: the backend may have gone on and
        // submitted. Look, as for a thrown error (`describeFailure` folds a
        // timeout into data, so it is not thrown).
        thrown = result.code === "backend_timeout";
      }
    } catch (err) {
      thrown = true;
      // A thrown error is the request itself failing (for example the 60 s
      // timeout), not an answer from the backend: say what is known.
      message =
        err instanceof Error
          ? `Could not confirm the submit: ${err.message}. Check My snapshot drafts before trying again.`
          : "Could not confirm the submit. Check My snapshot drafts before trying again.";
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

  const compute = saved
    ? effectiveCompute(
        saved.slurm_config,
        recommended,
        runsClimatology(saved.parameters.post_processing, snapshotOutput)
      )
    : null;

  const done = stage === "done";

  const body = (
    <>
      {blocked && !done && (
        <div id={noteId} className="space-y-2">
          <p className="text-sm text-foreground">
            {problems.length === 1
              ? "Fix this to submit:"
              : `Fix these ${problems.length} things to submit:`}
          </p>
          <ul className="space-y-1.5">
            {problems.map((problem, i) => (
              <li
                key={`${problem.field ?? "draft"}-${i}`}
                className="flex flex-col gap-0.5 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <p className="flex min-w-0 items-start gap-2 text-warning">
                  <AlertTriangle className="mt-1 size-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">
                    {problem.field && <span className="font-medium">{FIELD_LABELS[problem.field]}: </span>}
                    {problem.message}
                  </span>
                </p>
                {problem.field && (
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => onFix(problem.step, problem.field)}
                    aria-label={`Fix ${FIELD_LABELS[problem.field].toLowerCase()}`}
                    className="ml-5 h-auto min-h-10 shrink-0 justify-start p-0 text-sm sm:ml-0 sm:min-h-8"
                  >
                    Fix
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          {rerun ? (
            <p className="flex items-start gap-2 text-sm text-warning">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">
                Already published. Running it again repeats a published result and uses compute time.
              </span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Submitting saves your changes first, then runs it on Anvil and uses compute time.
            </p>
          )}
          <Button
            type="button"
            variant={rerun ? "outline" : "default"}
            size={rerun ? "default" : "xl"}
            disabled={blocked || stage !== "idle"}
            aria-describedby={blocked ? noteId : undefined}
            onClick={() => void start()}
            className={
              rerun
                ? "min-h-10 w-full shrink-0 border-warning/40 px-6 text-warning hover:bg-warning/10 hover:text-warning sm:w-auto"
                : "w-full shrink-0 sm:w-auto"
            }
          >
            {stage === "flushing" ? (
              <>
                <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : rerun ? (
              <>
                <RotateCw aria-hidden="true" />
                Run anyway
              </>
            ) : (
              <>
                <Send aria-hidden="true" />
                Submit to Anvil
              </>
            )}
          </Button>
        </div>
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
            <AlertDialogTitle className={rerun ? "flex items-center gap-2 text-warning" : undefined}>
              {rerun && <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />}
              {rerun ? "Run it again anyway?" : "Submit this snapshot draft to Anvil?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {rerun
                ? "These results are already published, so running it again only checks that they reproduce. It uses compute time on your allocation. Check the summary first."
                : "This starts the simulation and spends compute time. Check the summary first."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {saved && compute && (
            <SubmitSummary
              snapshotTitle={saved.dataset_title}
              start={saved.parameters.temporal_range_start}
              end={saved.parameters.temporal_range_end}
              variables={saved.parameters.variables}
              output={saved.parameters.post_processing ?? snapshotOutput}
              cores={compute.cores}
              coresFromSnapshot={compute.coresSource === "snapshot"}
              walltime={compute.walltime}
              walltimeFromSnapshot={compute.walltimeSource === "snapshot"}
              walltimeCapped={compute.walltimeCapped}
              walltimeIncludesPostProcessing={compute.includesPostProcessing}
              coresWarning={describeCoresBelowRecommended(saved.slurm_config, recommended)}
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
              ) : rerun ? (
                "Run anyway"
              ) : (
                "Submit to Anvil"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  // A rerun sits below the published results, outside the review panel: no
  // "Submit" section of its own.
  return rerun ? (
    <div className="space-y-4 rounded-card border border-border/70 bg-card p-6 shadow-card sm:px-7">{body}</div>
  ) : (
    <DraftSection title="Submit">{body}</DraftSection>
  );
}
