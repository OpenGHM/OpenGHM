"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight } from "lucide-react";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { Button } from "@/components/ui/button";
import { ActionError } from "@/components/workspace/action-error";
import { focusDraftField } from "@/components/workspace/draft-field";
import { DraftProgress } from "@/components/workspace/draft-progress";
import { DraftReviewStep } from "@/components/workspace/draft-review-step";
import { DraftRunStep } from "@/components/workspace/draft-run-step";
import { stepHeadingId } from "@/components/workspace/draft-step-heading";
import { DraftSubmitCard } from "@/components/workspace/draft-submit-card";
import { JobDeleteButton } from "@/components/workspace/job-delete-button";
import { PageHeader, SimulationBreadcrumb, WORKSPACE_MAIN } from "@/components/workspace/page-header";
import { SaveStatus } from "@/components/workspace/save-status";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { fetchJob, submitSimulation } from "@/lib/jobs/actions";
import { displayName } from "@/lib/jobs/display-name";
import { simulationSource } from "@/lib/jobs/simulation-source";
import type { Job, SubmitError } from "@/lib/jobs/types";
import { newerJob, writeDraftCache } from "@/lib/workspace/draft-cache";
import {
  fromJob,
  submitProblems,
  type DraftContext,
  type DraftField,
  type DraftLocal,
} from "@/lib/workspace/draft-state";
import {
  DRAFT_STEPS,
  FIELD_STEP,
  isRetiredStep,
  parseStep,
  recommendedComputeFor,
  stepHref,
  type DraftStep,
} from "@/lib/workspace/draft-wizard";
import { effectiveModelInputId, useCatalogueModelInput } from "@/lib/workspace/use-catalogue-model-input";
import { useDraftAutosave } from "@/lib/workspace/use-draft-autosave";

/** After a submit went through, how long Next gets to show the job's page by
 *  itself before the wizard checks the server and steps in. */
const OPEN_FALLBACK_MS = 2_500;
/** The checks after that one, and the gap between them. */
const OPEN_RETRIES = 3;
const OPEN_RETRY_MS = 2_000;

/** What the header calls a draft: the list's `displayName` rule applied to the
 *  name being typed (then the slug, the run id, `Untitled (<id8>)`), so a draft
 *  reads the same in the list and here. Follows the input on every keystroke.
 *  `Untitled (<id8>)` is only this display fallback: it is never stored and
 *  never put in the Name input, which stays empty until the user names it. */
function liveName(name: string, job: Job): string {
  return displayName({ ...job, about: { name: name.trim() } });
}

/** The step the address bar names right now. */
function stepFromLocation(): DraftStep {
  return parseStep(new URLSearchParams(window.location.search).get("step"));
}

/**
 * A draft, edited in place: the wizard behind `/workspace/<id>?step=...` (ADR
 * 0028). It owns the local copy of the draft, which step is showing, and the
 * auto-save (`useDraftAutosave`), and lays out the page: the header (name, status,
 * save status, Delete, the steps) over the content of the current step.
 *
 * - **Starting point.** The job the server rendered, or the copy of it this tab
 *   last saw saved when that is newer (Next can restore a page from its
 *   back/forward cache with props that predate it). When the server sends a
 *   different job later (after Reload), or the tab comes back into view with
 *   nothing unsaved and the server's copy has moved on, the wizard starts over
 *   from it.
 * - **Steps.** The URL says which one (Run settings or Review); Next, Back and
 *   the progress strip change it with `history.pushState`, so there is no server
 *   round trip. Each change saves what is waiting and moves focus to the step's
 *   heading. Nothing blocks a step: what stands in the way of a submit is flagged
 *   on the strip and listed beside the Submit button. An address that still says
 *   `?step=model` (the step this replaced) is rewritten to `?step=run`.
 */
export function DraftWizard({
  job,
  ctx,
  blockedReason,
  initialStep,
}: {
  /** The draft as the server page read it. */
  job: Job;
  ctx: DraftContext;
  /** Why this user cannot submit (ADR 0024), or null. */
  blockedReason: string | null;
  initialStep: DraftStep;
}) {
  const [seen, setSeen] = useState(job);
  const [start, setStart] = useState(() => ({ job: newerJob(job), step: initialStep, epoch: 0 }));
  // The server page rendered again with another copy (Reload, a refresh); its
  // `initialStep` is the address bar's as of then.
  if (job !== seen) {
    setSeen(job);
    if (job.updated_at !== seen.updated_at) setStart((s) => ({ job, step: initialStep, epoch: s.epoch + 1 }));
  }
  // Back in view with the server's copy moved on: start over from it, on the
  // step the address bar shows now.
  const reload = useCallback((fresh: Job) => {
    writeDraftCache(fresh);
    setStart((s) => ({ job: fresh, step: stepFromLocation(), epoch: s.epoch + 1 }));
  }, []);

  return (
    <WizardBody
      key={start.epoch}
      initialJob={start.job}
      ctx={ctx}
      blockedReason={blockedReason}
      initialStep={start.step}
      onReload={reload}
    />
  );
}

function WizardBody({
  initialJob,
  ctx,
  blockedReason,
  initialStep,
  onReload,
}: {
  initialJob: Job;
  ctx: DraftContext;
  blockedReason: string | null;
  initialStep: DraftStep;
  onReload: (job: Job) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobId = initialJob.id;

  const [local, setLocal] = useState<DraftLocal>(() => fromJob(initialJob));
  // A draft nobody has named, opened on Run settings (a new one is): the Name
  // is the first thing on the page, so it takes focus. Read once; a draft that
  // has a name, or that opens on Review, is left alone.
  const [focusNameOnOpen] = useState(() => initialStep === "run" && !initialJob.about?.name?.trim());
  const [submitting, setSubmitting] = useState(false);
  const [lastSubmitError, setLastSubmitError] = useState<SubmitError | null>(
    initialJob.last_submit_error ?? null
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteExpired, setDeleteExpired] = useState(false);
  const deleted = useRef(false);
  // The address of the job's page once a submit went through; the card offers a
  // link to it when the page did not follow.
  const [pageStuck, setPageStuck] = useState<string | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (openTimer.current !== null) clearTimeout(openTimer.current);
    };
  }, []);

  const autosave = useDraftAutosave({ jobId, initialSaved: initialJob, local, ctx });
  const { flush, suspend, resume } = autosave;
  const modelInput = useCatalogueModelInput(effectiveModelInputId(local.modelInputId, ctx.dataset));

  // ── The step ──────────────────────────────────────────────────────────────
  // The server's reading first. Afterwards the URL is the truth: our own pushes
  // set the step directly (Next's router follows a native pushState, so
  // `useSearchParams` catches up with them), and anything else that moves the
  // URL, the browser's back/forward included, comes through `useSearchParams`.
  // Back/forward is also heard directly, so the step does not wait for Next.
  const [step, setStep] = useState<DraftStep>(initialStep);
  const urlStep = parseStep(searchParams.get("step"));
  const [seenUrlStep, setSeenUrlStep] = useState(urlStep);
  if (urlStep !== seenUrlStep) {
    setSeenUrlStep(urlStep);
    setStep(urlStep);
  }
  useEffect(() => {
    const onPopState = () => setStep(stepFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // The field an Edit link or a "fix <field>" link asked to focus, until the
  // effect below has done it. `focusTick` makes a second request for the same
  // step (the step does not change, so nothing else would re-run the effect).
  const focusRequest = useRef<DraftField | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const goTo = useCallback(
    (next: DraftStep, field?: DraftField) => {
      const url = stepHref(jobId, next);
      // A native pushState adds an entry even for the URL we are on.
      if (url !== window.location.pathname + window.location.search) {
        window.history.pushState(null, "", url);
      }
      focusRequest.current = field ?? null;
      if (field) setFocusTick((n) => n + 1);
      setStep(next);
    },
    [jobId]
  );

  // A new step (from a button, the strip, or the browser's back/forward): save
  // what is waiting, and send focus to its heading. Not on the first render.
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    void flush();
    document.getElementById(stepHeadingId(step))?.focus();
  }, [step, flush]);

  // A field was asked for: once its step has rendered, focus it (the heading
  // when the step has no such control). Declared after the effect above, so it
  // wins over the heading. Once per request.
  useEffect(() => {
    const field = focusRequest.current;
    if (field === null) return;
    focusRequest.current = null;
    focusDraftField(field, step);
  }, [step, focusTick]);

  // The retired "model" step opens Run settings; say so in the address bar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!isRetiredStep(params.get("step"))) return;
    window.history.replaceState(null, "", stepHref(jobId, "run"));
  }, [jobId]);

  // ── Back in view ──────────────────────────────────────────────────────────
  // Another tab or a submit elsewhere may have moved the draft on while this
  // one was away. Only when nothing here is unsaved, so nothing is lost.
  const clean = autosave.state.kind === "saved";
  const latest = useRef({ clean, savedAt: autosave.saved.updated_at });
  useEffect(() => {
    latest.current = { clean, savedAt: autosave.saved.updated_at };
  });
  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== "visible" || !latest.current.clean) return;
      const result = await fetchJob(jobId).catch(() => null);
      // Edited while it was out: the next save settles it.
      if (!result || !result.ok || !latest.current.clean) return;
      if (result.data.status !== "DRAFT") router.refresh();
      else if (result.data.updated_at !== latest.current.savedAt) onReload(result.data);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [jobId, router, onReload]);

  // ── What is wrong with the draft ──────────────────────────────────────────
  // `saving` is left out: Submit saves first, so a pause in the middle of a
  // save is not something to fix, and it must not flash a warning on every key.
  const problems = useMemo(
    () => submitProblems(local, ctx, blockedReason, { withheld: autosave.withheld, saving: false }),
    [local, ctx, blockedReason, autosave.withheld]
  );
  const problemSteps = useMemo(
    () => DRAFT_STEPS.filter((s) => problems.some((p) => p.step === s)),
    [problems]
  );

  const recommended = recommendedComputeFor(ctx.dataset);
  const source = simulationSource(initialJob);
  const name = liveName(local.name, initialJob);
  const index = DRAFT_STEPS.indexOf(step);

  // ── Submit and delete ─────────────────────────────────────────────────────
  const onSubmitted = (submitted: Job) => {
    const url = `/workspace/${encodeURIComponent(submitted.id)}`;
    setLastSubmitError(null);
    router.replace(url);
    router.refresh();

    // Next should now swap this page for the job's. If this wizard is still on
    // screen a moment later it did not (a real browser did this once):
    // ask the server, and when the job has left DRAFT load its page the hard
    // way, which always shows what the server holds. When it cannot be
    // confirmed, say so and link to the page.
    if (openTimer.current !== null) clearTimeout(openTimer.current);
    const check = async (retriesLeft: number) => {
      openTimer.current = null;
      const result = await fetchJob(submitted.id).catch(() => null);
      if (!mounted.current) return;
      if (result?.ok && result.data.status !== "DRAFT") {
        window.location.assign(url);
        return;
      }
      if (retriesLeft > 0) openTimer.current = setTimeout(() => void check(retriesLeft - 1), OPEN_RETRY_MS);
      else setPageStuck(url);
    };
    openTimer.current = setTimeout(() => void check(OPEN_RETRIES), OPEN_FALLBACK_MS);
  };
  // For a submit whose answer was lost: the job, if it is no longer a draft.
  const checkSubmitted = async (id: string): Promise<Job | null> => {
    const result = await fetchJob(id).catch(() => null);
    return result?.ok && result.data.status !== "DRAFT" ? result.data : null;
  };
  const onSubmitFailed = () => {
    // Still a draft, and auto-save was suspended for the submit.
    resume();
    void fetchJob(jobId)
      .then((result) => {
        if (!result.ok) return;
        if (result.data.status !== "DRAFT") router.refresh();
        else setLastSubmitError(result.data.last_submit_error ?? null);
      })
      .catch(() => {});
  };

  const state = autosave.state;

  return (
    <main className={WORKSPACE_MAIN}>
      <PageHeader
        top={<SimulationBreadcrumb current={name} />}
        title={name}
        badge={<JobStatusBadge status="DRAFT" />}
        meta={
          <p className="mt-2.5 min-w-0 text-sm text-muted-foreground">
            <Link
              href={source.href}
              title={source.title}
              className="block max-w-full truncate rounded underline-offset-2 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              Based on {source.title}
            </Link>
          </p>
        }
        aside={
          <div className="flex flex-wrap items-center gap-3 sm:justify-end">
            <SaveStatus
              state={state}
              onRetry={autosave.retry}
              onGoToField={(field) => goTo(FIELD_STEP[field], field)}
            />
            <JobDeleteButton
              jobId={jobId}
              isDraft
              workDir={null}
              remoteJobDir={null}
              files={null}
              onOpen={() => {
                setDeleteError(null);
                setDeleteExpired(false);
              }}
              onOpenChange={(open) => {
                // Nothing is saved behind a Delete that may go through. A
                // dialog that closes without deleting gives saving back.
                if (open) suspend();
                else if (!deleted.current) resume();
              }}
              onDeleted={() => {
                deleted.current = true;
                suspend();
                router.push("/workspace");
              }}
              onError={setDeleteError}
              onSessionExpired={() => setDeleteExpired(true)}
            />
          </div>
        }
      >
        {deleteExpired && <SessionExpiredBanner className="mt-4 w-full sm:max-w-md" />}
        {deleteError && (
          <div className="mt-4">
            <ActionError>{deleteError}</ActionError>
          </div>
        )}
        <DraftProgress jobId={jobId} current={step} problemSteps={problemSteps} onSelectStep={goTo} />
      </PageHeader>

      <div className="flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
        <div className="mx-auto max-w-[1024px]">
          {state.kind === "session-expired" && <SessionExpiredBanner className="mb-6" />}
          {state.kind === "conflict" && (
            <div
              role="alert"
              className="mb-6 flex flex-col gap-3 rounded-lg border border-warning/25 bg-warning/5 p-3 text-sm text-warning sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="flex items-start gap-2 font-medium">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                This simulation was submitted or changed elsewhere
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => router.refresh()}
                className="min-h-10 shrink-0 border-warning/30 bg-background text-warning hover:bg-warning/10 sm:min-h-8"
              >
                Reload
              </Button>
            </div>
          )}
          {state.kind === "gone" && (
            <div
              role="alert"
              className="mb-6 flex flex-col gap-3 rounded-lg border border-warning/25 bg-warning/5 p-3 text-sm text-warning sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="flex items-start gap-2 font-medium">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                This draft was deleted
              </p>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="min-h-10 shrink-0 border-warning/30 bg-background text-warning hover:bg-warning/10 sm:min-h-8"
              >
                <Link href="/workspace">Go to My Simulations</Link>
              </Button>
            </div>
          )}

          {/* Focus leaving the step is a reason to save without waiting. */}
          <div
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void flush();
            }}
          >
            {step === "run" && (
              <DraftRunStep
                datasetId={initialJob.dataset_id}
                datasetTitle={initialJob.dataset_title}
                ctx={ctx}
                parameters={local.parameters}
                slurm={local.slurm}
                recommended={recommended}
                modelInputId={local.modelInputId}
                resolvedModelInput={modelInput}
                name={local.name}
                description={local.description}
                autoFocusName={focusNameOnOpen}
                onNameChange={(value) => setLocal((l) => ({ ...l, name: value }))}
                onDescriptionChange={(value) => setLocal((l) => ({ ...l, description: value }))}
                serverErrors={autosave.serverErrors}
                startRefusal={autosave.startRefusal}
                onParametersChange={(parameters) => setLocal((l) => ({ ...l, parameters }))}
                onSlurmChange={(slurm) => setLocal((l) => ({ ...l, slurm }))}
                onRevertModelInput={() => setLocal((l) => ({ ...l, modelInputId: null }))}
                disabled={submitting}
              />
            )}
            {step === "review" && (
              <DraftReviewStep
                datasetId={initialJob.dataset_id}
                datasetTitle={initialJob.dataset_title}
                ctx={ctx}
                local={local}
                recommended={recommended}
                onEditStep={goTo}
                disabled={submitting}
                submitArea={
                  <DraftSubmitCard
                    jobId={jobId}
                    problems={problems}
                    onFix={goTo}
                    lastSubmitError={lastSubmitError}
                    recommended={recommended}
                    flush={flush}
                    suspend={suspend}
                    submit={submitSimulation}
                    onSubmitted={onSubmitted}
                    onSubmitFailed={onSubmitFailed}
                    onSubmittingChange={setSubmitting}
                    checkSubmitted={checkSubmitted}
                    openJobHref={pageStuck}
                  />
                }
              />
            )}
          </div>

          {/* Never blocked: a step with problems says so on the strip. Run
              settings has no Back (the browser's goes to Start from), Review no
              Next. */}
          <div className="mt-8 flex items-center justify-between gap-3">
            {step === "run" ? (
              <span />
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => goTo(DRAFT_STEPS[index - 1])}
                className="min-h-10"
              >
                <ArrowLeft aria-hidden="true" />
                Back
              </Button>
            )}
            {step !== "review" && (
              <Button type="button" onClick={() => goTo(DRAFT_STEPS[index + 1])} className="min-h-10">
                Next
                <ArrowRight aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
