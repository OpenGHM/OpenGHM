"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, ArrowRight } from "lucide-react";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { Button } from "@/components/ui/button";
import { ActionError } from "@/components/workspace/action-error";
import { focusDraftField } from "@/components/workspace/draft-field";
import { DraftProgress } from "@/components/workspace/draft-progress";
import { DraftReviewStep } from "@/components/workspace/draft-review-step";
import { DraftRunStep } from "@/components/workspace/draft-run-step";
import { stepHeadingId } from "@/components/workspace/draft-step-heading";
import { snapshotOutput } from "@/components/workspace/output-choice-field";
import { DraftSubmitCard } from "@/components/workspace/draft-submit-card";
import { JobDeleteButton } from "@/components/workspace/job-delete-button";
import { LeaveDraftDialog } from "@/components/workspace/leave-draft-dialog";
import { NewDraftStatus, SaveDraftButton } from "@/components/workspace/new-draft-controls";
import { PageBody } from "@/components/layout/page-hero";
import { PageHeader, draftBreadcrumb } from "@/components/workspace/page-header";
import { SaveStatus } from "@/components/workspace/save-status";
import { WizardLayout } from "@/components/workspace/wizard-layout";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { describeSubmitFailure } from "@/components/workspace/submit-summary";
import { fetchJob, submitDraft } from "@/lib/jobs/actions";
import { displayName } from "@/lib/jobs/display-name";
import { draftSource } from "@/lib/jobs/draft-source";
import { clampClass } from "@/components/common/clamped-name";
import type { ActionFailure, ActionResult, Job, SubmitError } from "@/lib/jobs/types";
import { newerJob, writeDraftCache } from "@/lib/workspace/draft-cache";
import {
  fromJob,
  isDirty,
  submitProblems,
  type DraftContext,
  type DraftField,
  type DraftLocal,
} from "@/lib/workspace/draft-state";
import {
  DRAFT_STEPS,
  FIELD_LABELS,
  FIELD_STEP,
  isRetiredStep,
  newStepHref,
  newWizardPath,
  parseStep,
  recommendedComputeFor,
  stepHref,
  type DraftStep,
} from "@/lib/workspace/draft-wizard";
import { useLeaveGuard, type LeaveTarget } from "@/lib/workspace/leave-guard";
import { describeNotSaved } from "@/lib/workspace/save-new-draft";
import { effectiveModelInputId, useCatalogueModelInput } from "@/lib/workspace/use-catalogue-model-input";
import { checkProblems, dateMessages } from "@/lib/workspace/draft-checks";
import { changedPaths } from "@/lib/workspace/model-parameters";
import { useModelParameters } from "@/lib/workspace/use-model-parameters";
import { type FlushResult, type SaveState, useDraftSaver } from "@/lib/workspace/use-draft-saver";
import { useDraftChecks } from "@/lib/workspace/use-draft-checks";
import { usePublishedAnswer } from "@/lib/workspace/use-published-answer";
import { useSaveNewDraft } from "@/lib/workspace/use-save-new-draft";

/** Which draft the wizard edits: one that is stored (`/workspace/<id>`, saved as
 *  it is edited), or a new snapshot draft that exists only in this browser until
 *  the person saves it (`/workspace/new/<snapshot id>`). */
export type WizardMode = { kind: "saved" } | { kind: "new"; datasetId: string };

const SAVED: WizardMode = { kind: "saved" };

const noop = () => {};

/** What nothing is saved for: the new mode has no server answers to show. */
const NO_ERRORS: Partial<Record<DraftField, string>> = {};
const NO_FIELDS: DraftField[] = [];

/** After a submit went through, how long Next gets to show the job's page by
 *  itself before the wizard checks the server and steps in. */
const OPEN_FALLBACK_MS = 2_500;
/** The checks after that one, and the gap between them. */
const OPEN_RETRIES = 3;
const OPEN_RETRY_MS = 2_000;

/** A submit the backend refused because the snapshot already publishes the
 *  result. */
function isAnsweredRefusal(failure: ActionFailure): boolean {
  return failure.reason === "error" && failure.code === "answered_by_published";
}

/** What the header calls a draft: the list's `displayName` rule applied to the
 *  name being typed (then the slug, the run id, `Untitled (<id8>)`), without the
 *  name the list makes of the snapshot's title: an unnamed draft is said to be
 *  unnamed here, where its name is being typed. Follows the input on every
 *  keystroke. `Untitled (<id8>)` is only this display fallback: it is never
 *  stored and never put in the Name input, which stays empty until the user
 *  names it. */
function liveName(name: string, job: Job): string {
  return displayName({ ...job, about: { name: name.trim() }, dataset_title: undefined });
}

/** The path of the wizard without its query: what its own step links share. */
function wizardPath(isNew: boolean, datasetId: string, jobId: string): string {
  return isNew ? newWizardPath(datasetId) : `/workspace/${encodeURIComponent(jobId)}`;
}

/** Why a stored draft's Save button is off, for its tooltip, by what the save
 *  status says. */
function whyNotSaveable(kind: SaveState["kind"]): string | undefined {
  switch (kind) {
    case "saved":
      return "No changes to save";
    case "refused":
      return "Fix the settings that can't be saved first";
    case "session-expired":
      return "Sign in again to save";
    case "conflict":
    case "gone":
      return "This draft can't be saved any more";
    case "suspended":
      return "Finish or close what is open first";
    default:
      return undefined;
  }
}

/** The step the address bar names right now. */
function stepFromLocation(fallback?: DraftStep): DraftStep {
  return parseStep(new URLSearchParams(window.location.search).get("step"), fallback);
}

/**
 * A draft, edited in place: the wizard behind `/workspace/<id>?step=...` (ADR
 * 0028). It owns the local copy of the draft, which step is showing, and the
 * saving (`useDraftSaver`), and lays out the page: the header (name, save
 * status and button, Delete, the steps) over the content of the current step.
 * Nothing is saved by itself: the Save draft button (or Ctrl/Cmd+S), Submit and
 * the leave dialog are the only things that send, and leaving with unsaved
 * changes asks first (`useLeaveGuard`).
 *
 * - **Starting point.** The job the server rendered, or the copy of it this tab
 *   last saw saved when that is newer (Next can restore a page from its
 *   back/forward cache with props that predate it). When the server sends a
 *   different job later (after Reload), or the tab comes back into view with
 *   nothing unsaved and the server's copy has moved on, the wizard starts over
 *   from it.
 * - **Steps.** The URL says which one (Run settings or Review); Next, Back and
 *   the progress strip change it with `history.pushState`, so there is no server
 *   round trip. Each change moves focus to the step's heading and saves
 *   nothing. Nothing blocks a step: what stands in the way of a submit is flagged
 *   on the strip and listed beside the Submit button. An address that still says
 *   `?step=model` (the step this replaced) is rewritten to `?step=run`.
 *
 * `mode` `new` is a snapshot draft nobody has saved: `job` is the draft the server
 * would create (it has no id), everything stays in the browser, and "Save as
 * draft" (or Submit) creates the stored draft.
 */
export function DraftWizard({
  job,
  ctx,
  blockedReason,
  initialStep,
  mode = SAVED,
}: {
  /** The draft as the server page read it. */
  job: Job;
  ctx: DraftContext;
  /** Why this user cannot submit (ADR 0024), or null. */
  blockedReason: string | null;
  initialStep: DraftStep;
  mode?: WizardMode;
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

  if (mode.kind === "new") {
    // The preview is the baseline for good: no cache, no reload.
    return (
      <WizardBody
        key={mode.datasetId}
        initialJob={job}
        mode={mode}
        ctx={ctx}
        blockedReason={blockedReason}
        initialStep={initialStep}
        onReload={reload}
      />
    );
  }

  return (
    <WizardBody
      key={start.epoch}
      initialJob={start.job}
      mode={mode}
      ctx={ctx}
      blockedReason={blockedReason}
      initialStep={start.step}
      onReload={reload}
    />
  );
}

function WizardBody({
  initialJob,
  mode,
  ctx,
  blockedReason,
  initialStep,
  onReload,
}: {
  initialJob: Job;
  mode: WizardMode;
  ctx: DraftContext;
  blockedReason: string | null;
  initialStep: DraftStep;
  onReload: (job: Job) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const newDatasetId = mode.kind === "new" ? mode.datasetId : null;
  const isNew = newDatasetId !== null;
  // A new snapshot draft has no job id (the preview's is meaningless): its steps
  // are addressed by the snapshot, and it opens on Run settings.
  const jobId = isNew ? "" : initialJob.id;
  const datasetId = newDatasetId ?? initialJob.dataset_id;
  const defaultStep: DraftStep = isNew ? "run" : "review";
  const hrefFor = useCallback(
    (target: DraftStep) => (newDatasetId !== null ? newStepHref(newDatasetId, target) : stepHref(jobId, target)),
    [newDatasetId, jobId]
  );

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

  // Nothing is saved by itself, in either mode: `saver.flush()` is the one thing that
  // sends, from a button. A new snapshot draft is not stored, so the hook is off for it.
  const saver = useDraftSaver({ jobId, initialSaved: initialJob, local, ctx, disabled: isNew });
  const { flush, suspend, resume } = saver;
  const modelInput = useCatalogueModelInput(effectiveModelInputId(local.modelInputId, ctx.dataset));
  // The snapshot's parameter tree: the Model parameters section renders it, and
  // Review names the changed parameters with it. Nothing else waits for it.
  const { state: modelParameters, retry: retryModelParameters } = useModelParameters(datasetId);

  // ── The step ──────────────────────────────────────────────────────────────
  // The server's reading first. Afterwards the URL is the truth: our own pushes
  // set the step directly (Next's router follows a native pushState, so
  // `useSearchParams` catches up with them), and anything else that moves the
  // URL, the browser's back/forward included, comes through `useSearchParams`.
  // Back/forward is also heard directly, so the step does not wait for Next.
  const [step, setStep] = useState<DraftStep>(initialStep);
  const urlStep = parseStep(searchParams.get("step"), defaultStep);
  const [seenUrlStep, setSeenUrlStep] = useState(urlStep);
  if (urlStep !== seenUrlStep) {
    setSeenUrlStep(urlStep);
    setStep(urlStep);
  }
  const ownPath = wizardPath(isNew, datasetId, jobId);
  useEffect(() => {
    const onPopState = () => {
      // A move out of the wizard is not a step change.
      if (window.location.pathname === ownPath) setStep(stepFromLocation(defaultStep));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [defaultStep, ownPath]);

  // The snapshot's published results for what is on screen, asked once the
  // Review step shows (saved or not: the question is the parameters).
  const { state: publishedState, refresh: refreshAnswer } = usePublishedAnswer({
    datasetId,
    parameters: local.parameters,
    modelInputId: local.modelInputId,
    enabled: step === "review",
  });

  // What the rules of the parameter tree say about the draft on screen (a dataset that ends
  // before the run does, an output that needs a block). Asked once Review shows, and kept for
  // the same parameters so Run settings can show a date error beside its input.
  const checks = useDraftChecks({
    datasetId,
    parameters: local.parameters,
    enabled: step === "review",
  });

  // The field an Edit link or a "fix <field>" link asked to focus, until the
  // effect below has done it. `focusTick` makes a second request for the same
  // step (the step does not change, so nothing else would re-run the effect).
  const focusRequest = useRef<DraftField | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const goTo = useCallback(
    (next: DraftStep, field?: DraftField) => {
      const url = hrefFor(next);
      // A native pushState adds an entry even for the URL we are on.
      if (url !== window.location.pathname + window.location.search) {
        window.history.pushState(null, "", url);
      }
      focusRequest.current = field ?? null;
      if (field) setFocusTick((n) => n + 1);
      setStep(next);
    },
    [hrefFor]
  );

  // A new step (from a button, the strip, or the browser's back/forward): send
  // focus to its heading. Not on the first render. Changing step saves nothing.
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    document.getElementById(stepHeadingId(step))?.focus();
  }, [step]);

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
    window.history.replaceState(null, "", hrefFor("run"));
  }, [hrefFor]);

  // ── Back in view ──────────────────────────────────────────────────────────
  // Another tab or a submit elsewhere may have moved the draft on while this
  // one was away. Only when nothing here is unsaved, so nothing is lost.
  const clean = saver.state.kind === "saved";
  const latest = useRef({ clean, savedAt: saver.saved.updated_at });
  useEffect(() => {
    latest.current = { clean, savedAt: saver.saved.updated_at };
  });
  useEffect(() => {
    // Nothing is stored for a new snapshot draft: there is nothing to go stale.
    if (isNew) return;
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
  }, [isNew, jobId, router, onReload]);

  // ── What is wrong with the draft ──────────────────────────────────────────
  // `saving` is left out: Submit saves first, so a pause in the middle of a
  // save is not something to fix, and it must not flash a warning on every key.
  const problems = useMemo(
    () => submitProblems(local, ctx, blockedReason, { withheld: isNew ? NO_FIELDS : saver.withheld, saving: false }),
    [local, ctx, blockedReason, isNew, saver.withheld]
  );
  // The errors among the checks stop a submit like the problems above do, and are listed with
  // them; the steps' strip is about what the client knows, so they stay out of it.
  const submitBlockers = useMemo(
    () => [
      ...problems,
      ...(checks.status === "ready" ? checkProblems(checks.errors, changedPaths(local.parameters)) : []),
    ],
    [problems, checks, local.parameters]
  );
  const problemSteps = useMemo(
    () => DRAFT_STEPS.filter((s) => problems.some((p) => p.step === s)),
    [problems]
  );

  const recommended = recommendedComputeFor(ctx.dataset);
  const source = draftSource({ dataset_id: datasetId, dataset_title: initialJob.dataset_title });
  const name = isNew ? local.name.trim() || "New snapshot" : liveName(local.name, initialJob);
  const index = DRAFT_STEPS.indexOf(step);

  // ── Saving, and leaving ───────────────────────────────────────────────────
  // Saving is always a button: nothing is sent by itself. A new snapshot draft is
  // created by `newDraft` (inert for a stored draft); a stored one is saved by
  // `saver.flush()`. Once a save created the new draft, `saved` is what the
  // server holds, and "unsaved" is measured against that.
  const newDraft = useSaveNewDraft({ datasetId, ctx });
  const baseline = newDraft.saved ?? initialJob;
  const dirty = isNew && isDirty(local, baseline, ctx);
  // Set once a save or a submit went through and the page is on its way to the
  // draft: from then on nothing is asked about leaving, and nothing is saved twice.
  const [departing, setDeparting] = useState(false);
  // Unsaved work is what leaving would lose: a new snapshot draft that differs from
  // what the server would create, a stored draft with a difference waiting or a
  // withheld field. The wizard's own step links are not leaving. A stored
  // draft's saver already asks the browser; a new snapshot draft's guard does.
  const guard = useLeaveGuard({
    active: (isNew ? dirty : saver.unsaved) && !departing,
    ownPath,
    beforeUnload: isNew,
  });
  // The reason the last submit gave, for the toast of one that did not go through.
  const submitFailure = useRef<ActionFailure | null>(null);

  /** Where a held-back move goes once it is allowed: a link is pushed, the
   *  browser's Back or Forward is traversed to. */
  const follow = (go: LeaveTarget) => guard.proceed(go, (href) => router.push(href));

  /** Save the new snapshot draft and go on: to its own page (`go` null,
   *  on the step showing) or to `go`. A draft that came out without some of the
   *  settings is still the draft: it opens, and a toast says what is missing.
   *  False when nothing was created, and the page then says why. */
  const saveAndGo = async (go: LeaveTarget | null): Promise<boolean> => {
    const result = await newDraft.save(local);
    if (result === null || !result.ok) return false;
    writeDraftCache(result.job);
    if (result.notSaved.length > 0) toast.error(describeNotSaved(result.notSaved));
    else toast.success("Snapshot draft saved");
    setDeparting(true);
    guard.stay();
    if (go === null) router.replace(stepHref(result.job.id, step));
    else follow(go);
    return true;
  };
  const discardAndGo = (go: LeaveTarget) => {
    setDeparting(true);
    guard.stay();
    follow(go);
  };

  /** Save the stored draft now: the Save draft button, Ctrl/Cmd+S, the leave
   *  dialog. True when the server holds everything on screen. A save that did
   *  not go through shows in the status (and Retry); one that left settings out
   *  says which. */
  const storing = useRef(false);
  const saveStored = async (): Promise<boolean> => {
    // One at a time: a second press before the first has answered is the first.
    if (storing.current) return false;
    storing.current = true;
    let result: FlushResult;
    try {
      result = await flush();
    } finally {
      storing.current = false;
    }
    if (!result.ok) return false;
    if (result.withheld.length > 0) {
      toast.error(`Saved, but these settings weren't: ${result.withheld.map((f) => FIELD_LABELS[f]).join(", ")}.`);
      return false;
    }
    toast.success("Snapshot draft saved");
    return true;
  };
  const saveStoredAndGo = async (go: LeaveTarget) => {
    if (!(await saveStored())) {
      guard.stay();
      return;
    }
    setDeparting(true);
    guard.stay();
    follow(go);
  };

  const saving = isNew ? newDraft.saving : saver.state.kind === "saving";
  // The stored draft's button is on only when a save has something to do or to
  // try again; otherwise it says why not.
  const savedKind = saver.state.kind;
  const storedCanSave = savedKind === "unsaved" || savedKind === "failed";
  const saveDisabled = isNew ? departing || submitting : !storedCanSave || submitting;
  const saveReason = isNew ? undefined : whyNotSaveable(savedKind);
  const saveLabel = isNew ? "Save as draft" : "Save draft";
  const saveNow = () => {
    if (saveDisabled || saving) return;
    if (isNew) void saveAndGo(null);
    else void saveStored();
  };
  // Ctrl/Cmd+S is the Save button, and the browser's own "save page" is not
  // wanted here whether or not there is anything to save.
  const saveNowRef = useRef(saveNow);
  useEffect(() => {
    saveNowRef.current = saveNow;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      saveNowRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Submit from Review: the first press creates the draft (once: a retry after a
  // failed submit finds it), and what the confirmation shows is what it holds.
  const newFlush = async (): Promise<FlushResult> => {
    const result = await newDraft.ensureSaved(local);
    if (!result.ok) return { ok: false };
    if (result.patchError !== null) {
      toast.error(`The snapshot draft was created, but its settings could not be saved: ${result.patchError}`);
      return { ok: false };
    }
    return { ok: true, job: result.job, withheld: result.notSaved };
  };
  const newSubmit = async (opts?: { rerun?: boolean }): Promise<ActionResult<Job>> => {
    submitFailure.current = null;
    const id = newDraft.created()?.id;
    if (!id) return { ok: false, reason: "error", message: "The snapshot draft was not created." };
    const result = opts ? await submitDraft(id, opts) : await submitDraft(id);
    if (!result.ok) {
      submitFailure.current = result;
      if (isAnsweredRefusal(result)) refreshAnswer();
    }
    return result;
  };
  // A stored draft's submit. Refused as answered means the Review step did not
  // know (the check was out of date or had failed): ask again, and the answer
  // card replaces the submit card.
  const storedSubmit = async (id: string, opts?: { rerun?: boolean }): Promise<ActionResult<Job>> => {
    const result = opts ? await submitDraft(id, opts) : await submitDraft(id);
    if (!result.ok && isAnsweredRefusal(result)) refreshAnswer();
    return result;
  };
  // The draft exists, so a failed submit goes on to it: it shows the reason the
  // server stored, and the person continues there.
  const onNewSubmitFailed = () => {
    const created = newDraft.created();
    if (!created) return;
    const failure = submitFailure.current;
    const why =
      failure === null
        ? null
        : failure.reason === "error"
          ? describeSubmitFailure(failure)
          : failure.reason === "session_expired"
            ? "Your session has expired."
            : "The snapshot draft no longer exists.";
    toast.error(`Your snapshot draft was saved, but it was not submitted.${why ? ` ${why}` : ""}`);
    setDeparting(true);
    router.replace(stepHref(created.id, "review"));
  };

  // ── Submit and delete ─────────────────────────────────────────────────────
  const onSubmitted = (submitted: Job) => {
    const url = `/workspace/${encodeURIComponent(submitted.id)}`;
    setDeparting(true);
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
        // A full load on purpose: the router already failed to move us.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
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
    // Still a draft, and saving was suspended for the submit.
    resume();
    void fetchJob(jobId)
      .then((result) => {
        if (!result.ok) return;
        if (result.data.status !== "DRAFT") router.refresh();
        else setLastSubmitError(result.data.last_submit_error ?? null);
      })
      .catch(() => {});
  };

  const state = saver.state;

  /** The submit card, or, for results that are already published, the same
   *  card as a rerun: the same save, confirm and submit, asking the backend to
   *  run it anyway. */
  const submitCard = (rerun: boolean) =>
    isNew ? (
      // Nothing is stored yet: Submit creates the draft first, once.
      <DraftSubmitCard
        jobId=""
        problems={submitBlockers}
        onFix={goTo}
        lastSubmitError={null}
        recommended={recommended}
        snapshotOutput={snapshotOutput(ctx.dataset)}
        modelParameters={modelParameters}
        flush={newFlush}
        suspend={noop}
        submit={() => newSubmit(rerun ? { rerun: true } : undefined)}
        onSubmitted={onSubmitted}
        onSubmitFailed={onNewSubmitFailed}
        onSubmittingChange={setSubmitting}
        checkSubmitted={() => checkSubmitted(newDraft.created()?.id ?? "")}
        openJobHref={pageStuck}
        rerun={rerun}
      />
    ) : (
      <DraftSubmitCard
        jobId={jobId}
        problems={submitBlockers}
        onFix={goTo}
        lastSubmitError={lastSubmitError}
        recommended={recommended}
        snapshotOutput={snapshotOutput(ctx.dataset)}
        modelParameters={modelParameters}
        flush={flush}
        suspend={suspend}
        submit={(id) => storedSubmit(id, rerun ? { rerun: true } : undefined)}
        onSubmitted={onSubmitted}
        onSubmitFailed={onSubmitFailed}
        onSubmittingChange={setSubmitting}
        checkSubmitted={checkSubmitted}
        openJobHref={pageStuck}
        rerun={rerun}
      />
    );

  return (
    <>
      <PageHeader
        breadcrumb={draftBreadcrumb(name)}
        title={name}
        badge={isNew ? undefined : <JobStatusBadge status="DRAFT" />}
        meta={
          <>
            {isNew && (
              <span className="inline-flex shrink-0 rounded-full border border-dashed border-hero-attention/70 px-2.5 py-1 text-xs font-semibold text-hero-attention-text">
                Not saved
              </span>
            )}
            <Link
              href={source.href}
              title={source.title}
              className={`${clampClass(1)} min-w-0 rounded text-sm underline-offset-2 outline-none transition-colors hover:text-white hover:underline focus-visible:ring-2 focus-visible:ring-hero-eyebrow`}
            >
              Based on {source.title}
            </Link>
          </>
        }
      >
        {newDraft.error?.reason === "session_expired" && <SessionExpiredBanner className="w-full sm:max-w-md" />}
        {newDraft.error?.reason === "error" && (
          <ActionError>Couldn&apos;t save the snapshot draft: {newDraft.error.message}</ActionError>
        )}
        {deleteExpired && <SessionExpiredBanner className="w-full sm:max-w-md" />}
        {deleteError && <ActionError>{deleteError}</ActionError>}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <DraftProgress hrefFor={hrefFor} current={step} problemSteps={problemSteps} onSelectStep={goTo} />
          <div className="flex flex-wrap items-center gap-2">
            {isNew ? (
              <>
                <NewDraftStatus
                  state={newDraft.saving ? "saving" : newDraft.saved && !dirty ? "saved" : "unsaved"}
                />
                <Button
                  asChild
                  variant="on-dark"
                  className="min-h-10 rounded-xl bg-transparent px-4 text-[13.5px] font-semibold hover:bg-white/10"
                >
                  <Link href="/workspace">Cancel</Link>
                </Button>
                <SaveDraftButton variant="on-dark" saving={saving} disabled={saveDisabled} onClick={saveNow} />
              </>
            ) : (
              <>
                <SaveStatus
                  state={state}
                  onRetry={saver.retry}
                  onGoToField={(field) => goTo(FIELD_STEP[field], field)}
                />
                <SaveDraftButton
                  variant="on-dark"
                  saving={saving}
                  disabled={saveDisabled}
                  reason={saveReason}
                  label={saveLabel}
                  onClick={saveNow}
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
              </>
            )}
            {step === "run" && (
              <Button
                type="button"
                onClick={() => goTo("review")}
                className="min-h-10 rounded-xl px-[18px] text-[13.5px] font-semibold"
              >
                Next: Review
                <ArrowRight aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </PageHeader>

      <PageBody className="flex-1">
        <WizardLayout
          step={step}
          facts={{ climatologyAvailable: ctx.dataset?.climatologyAvailable === true }}
        >
          {state.kind === "session-expired" && <SessionExpiredBanner className="mb-5 shadow-card" />}
          {state.kind === "conflict" && (
            <div
              role="alert"
              className="mb-5 flex flex-col gap-3 rounded-2xl border border-warning/30 bg-card p-4 text-sm text-warning shadow-card sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="flex items-start gap-2 font-medium">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                This snapshot draft was submitted or changed elsewhere
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
              className="mb-5 flex flex-col gap-3 rounded-2xl border border-warning/30 bg-card p-4 text-sm text-warning shadow-card sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="flex items-start gap-2 font-medium">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                This snapshot draft was deleted
              </p>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="min-h-10 shrink-0 border-warning/30 bg-background text-warning hover:bg-warning/10 sm:min-h-8"
              >
                <Link href="/workspace">Go to My snapshot drafts</Link>
              </Button>
            </div>
          )}

          <>
            {step === "run" && (
              <DraftRunStep
                datasetId={datasetId}
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
                serverErrors={isNew ? NO_ERRORS : saver.serverErrors}
                customErrors={isNew ? undefined : saver.customErrors}
                modelParameters={modelParameters}
                onRetryModelParameters={retryModelParameters}
                startRefusal={isNew ? null : saver.startRefusal}
                checks={checks.status === "ready" ? dateMessages(checks.errors) : undefined}
                onParametersChange={(parameters) => setLocal((l) => ({ ...l, parameters }))}
                onSlurmChange={(slurm) => setLocal((l) => ({ ...l, slurm }))}
                onRevertModelInput={() => setLocal((l) => ({ ...l, modelInputId: null }))}
                disabled={submitting}
              />
            )}
            {step === "review" && (
              <DraftReviewStep
                datasetId={datasetId}
                datasetTitle={initialJob.dataset_title}
                ctx={ctx}
                local={local}
                recommended={recommended}
                onEditStep={goTo}
                disabled={submitting}
                publishedAnswer={publishedState}
                checks={checks}
                modelParameters={modelParameters}
                submitArea={submitCard(publishedState.status === "answered")}
              />
            )}
          </>

          {/* Never blocked: a step with problems says so on the strip. Run
              settings has no Back (the browser's goes to Start from), Review no
              Next. */}
          <div className="mt-8 flex items-center justify-between gap-3">
            {step === "run" ? (
              <SaveDraftButton
                saving={saving}
                disabled={saveDisabled}
                reason={saveReason}
                label={saveLabel}
                onClick={saveNow}
              />
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
        </WizardLayout>
      </PageBody>

      <LeaveDraftDialog
        stored={!isNew}
        open={guard.target !== null}
        saving={saving}
        onSave={() => {
          const target = guard.target;
          if (target === null) return;
          if (isNew) {
            void saveAndGo(target).then((saved) => {
              if (!saved) guard.stay();
            });
          } else void saveStoredAndGo(target);
        }}
        onDiscard={() => {
          if (guard.target !== null) discardAndGo(guard.target);
        }}
        onKeep={guard.stay}
      />
    </>
  );
}
