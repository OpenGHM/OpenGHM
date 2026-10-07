import type {
  FailureCause,
  JobFailure,
  JobStatus,
  PublishFailure,
  PublishFailureCause,
  PublishRetry,
} from "@/lib/jobs/types";

/** What the person can do about it. The card turns this into a sentence
 *  (`NEXT_STEP_COPY`) and the buttons it offers. */
export type NextStep =
  | "resubmit"
  | "resubmit_longer_walltime"
  | "new_draft"
  | "contact_admin"
  | "admin_fixes_setup"
  | "none";

/** `danger`: something in this simulation's own setup. `warning`: a limit it hit.
 *  `neutral`: not caused by the input, or a deliberate stop. */
export type FailureTone = "danger" | "warning" | "neutral";

export interface FailureCopy {
  title: string;
  body: string;
  nextStep: NextStep;
  tone: FailureTone;
}

/**
 * The only place the wording for a verdict cause lives (ADR 0026). The backend
 * names the cause; nothing else in the frontend spells one out.
 *
 * Plain copy: what happened, and what to do. `body` is the fallback for a job
 * whose verdict carries no `message` (an old document); when there is one, the
 * card shows the message instead, because it names the facts of the simulation. So
 * `body` must read on its own, and refer to nothing shown next to it.
 */
export const FAILURE_COPY: Record<FailureCause, FailureCopy> = {
  fetch_failed: {
    title: "The model snapshot couldn't be downloaded",
    body: "The job could not fetch the model snapshot's files onto Anvil, so WBM never started.",
    nextStep: "resubmit",
    tone: "danger",
  },
  gateway_setup: {
    title: "Anvil isn't set up correctly for OpenGHM",
    body: "The gateway's setup on Anvil is broken, so the snapshot download could not start. The snapshot is not at fault.",
    nextStep: "admin_fixes_setup",
    tone: "neutral",
  },
  run_refused: {
    title: "The simulation was refused before it started",
    body: "The toolkit checked the model snapshot and this snapshot draft's settings and refused to start WBM.",
    nextStep: "new_draft",
    tone: "danger",
  },
  wbm_error: {
    title: "WBM stopped with an error",
    body: "WBM started and then exited with an error. The job's logs say what it reported.",
    nextStep: "new_draft",
    tone: "danger",
  },
  wbm_silent_failure: {
    title: "WBM stopped without finishing",
    body: "WBM exited normally but did not report that it finished, or it wrote no output, so there is no usable result.",
    nextStep: "new_draft",
    tone: "danger",
  },
  timeout: {
    title: "Ran out of time",
    body: "The job hit its walltime before WBM finished. Anything it wrote before that may still be on Anvil. Try a longer walltime, or a shorter run period if the walltime is already at its limit.",
    nextStep: "resubmit_longer_walltime",
    tone: "warning",
  },
  out_of_memory: {
    title: "Ran out of memory",
    body: "WBM needed more memory than the job was given, and Anvil stopped it. Try more cores (each has about 1.9 GB) or a shorter run period.",
    nextStep: "new_draft",
    tone: "warning",
  },
  node_failure: {
    title: "Anvil lost the job",
    body: "The node running this job failed, or Anvil took it back. This was not caused by your input.",
    nextStep: "resubmit",
    tone: "neutral",
  },
  lost: {
    title: "Anvil has no record of this job",
    body: "Anvil no longer knows this job and it left no result behind, so the gateway cannot say whether it ran.",
    nextStep: "contact_admin",
    tone: "neutral",
  },
  outcome_missing: {
    title: "The job ended without reporting a result",
    body: "Anvil says the job finished, but it did not write the record that says whether WBM succeeded, so the gateway cannot call it a success.",
    nextStep: "contact_admin",
    tone: "neutral",
  },
  cancelled_by_user: {
    title: "Cancelled",
    body: "This snapshot draft was stopped at its owner's request.",
    nextStep: "none",
    tone: "neutral",
  },
  cancelled_by_system: {
    title: "Cancelled by Anvil or an administrator",
    body: "This snapshot draft was stopped by someone other than its owner.",
    nextStep: "resubmit",
    tone: "neutral",
  },
};

/** A verdict whose cause this frontend has no wording for (the backend gained
 *  one first, or an old document names one that is gone). The card shows this
 *  title and the verdict's own `message`, never a crash. */
export const UNKNOWN_FAILURE_COPY: FailureCopy = {
  title: "The simulation ended with a problem",
  body: "This snapshot draft ended in a way this page has no wording for. The job's logs may say more.",
  nextStep: "new_draft",
  tone: "danger",
};

/** The copy for a verdict: its cause's, else `UNKNOWN_FAILURE_COPY`, and
 *  `UNRECORDED_FAILURE_COPY` when there is no verdict. The one lookup: never
 *  index `FAILURE_COPY` by a cause from the backend directly. */
export function failureCopyFor(failure: Pick<JobFailure, "cause"> | null | undefined): FailureCopy {
  if (!failure) return UNRECORDED_FAILURE_COPY;
  return (Object.hasOwn(FAILURE_COPY, failure.cause) ? FAILURE_COPY[failure.cause] : undefined) ?? UNKNOWN_FAILURE_COPY;
}

/** The sentence under the body that says what to do. */
export const NEXT_STEP_COPY: Record<NextStep, string> = {
  resubmit: "Try again from a new draft with the same settings.",
  resubmit_longer_walltime:
    "Try again from a new draft with the same settings, and pick a longer walltime before you submit it, or a shorter run period if the walltime is already at its limit.",
  new_draft:
    "Try again from a new draft, change what caused this, and submit it.",
  contact_admin:
    "Try again from a new draft. If it keeps happening, tell an administrator this snapshot draft's ID.",
  admin_fixes_setup:
    "An administrator has to fix the gateway's Anvil setup. Once they have, this snapshot draft can be tried again.",
  none: "",
};

/** Whether a failed job's card offers "Try again with these settings". */
export function offersNewDraft(step: NextStep): boolean {
  return step !== "none";
}

/** A FAILED job that carries no verdict: it ended before the gateway recorded
 *  causes. The card shows the reason the job stored, if any, in place of `body`. */
export const UNRECORDED_FAILURE_COPY: FailureCopy = {
  title: "The simulation failed",
  body: "This job failed before the gateway recorded why. The job's logs may say more.",
  nextStep: "new_draft",
  tone: "danger",
};

/**
 * Whether the status summary of a job in this status already has "Try again
 * with these settings", the copy action. It does for a cancelled job, and for a
 * failed one whose cause offers a new draft (`offersNewDraft`); the page header
 * offers "Duplicate" for every other ended job, so that each has the action once
 * and none has it twice.
 */
export function summaryOffersCopy(status: JobStatus, failure: JobFailure | null): boolean {
  if (status === "CANCELLED") return true;
  if (status !== "FAILED") return false;
  return offersNewDraft(failureCopyFor(failure).nextStep);
}

// ─── Publishing a snapshot draft as a snapshot (ADR 0031) ────────────────────

export interface PublishFailureCopy {
  title: string;
  /** What happened, for a failure that carries no `message` of its own. It
   *  never says what to do: the retry line under it does (`PUBLISH_RETRY_COPY`),
   *  from the failure's `retry`. */
  body: string;
}

/**
 * The wording for each cause a publish can fail with. The backend names the
 * cause and the retry (`app/services/publish.py`); nothing else in the
 * frontend spells one out. When the failure carries a `message` the card shows that
 * instead of `body`, because it is written for this publish.
 */
export const PUBLISH_FAILURE_COPY: Record<PublishFailureCause, PublishFailureCopy> = {
  publish_bad_input: {
    title: "Anvil's check refused the snapshot",
    body: "The checks before the upload refused the snapshot's description or the simulation's files, so nothing was uploaded.",
  },
  publish_output_incomplete: {
    title: "The simulation's output is incomplete",
    body: "The output does not hold every year and variable this snapshot draft asked for, or it holds an empty file, so nothing was uploaded.",
  },
  publish_conflict: {
    title: "Something already stored under this id differs",
    body: "A file of this snapshot is already in the repository with other content. The publish stopped before it replaced anything, because a published file is never overwritten.",
  },
  publish_setup: {
    title: "Anvil isn't set up to publish",
    body: "The gateway's publishing setup on Anvil is broken, so the upload could not start. The snapshot draft is not at fault.",
  },
  publish_upload_failed: {
    title: "The upload didn't finish",
    body: "Some of the snapshot's files could not be uploaded to the repository. The files already uploaded are kept.",
  },
  publish_verify_failed: {
    title: "The upload could not be verified",
    body: "The files were uploaded, but the check that every one of them can be read publicly did not pass, so the snapshot is not published.",
  },
  publish_job_failed: {
    title: "The publish job stopped",
    body: "Anvil stopped the publish job before it reported a result: it ran out of time, was cancelled, or was lost.",
  },
  publish_submit_interrupted: {
    title: "The publish was interrupted before it started",
    body: "The gateway lost its connection to Anvil while it submitted the publish job, so the job may never have started.",
  },
  // The submit's own refusals: the draft was claimed, then Anvil did not take the job.
  anvil_not_configured: {
    title: "Anvil isn't set up to run jobs yet",
    body: "This gateway is not set up to run jobs on Anvil yet, so the publish job could not be submitted. Nothing was published.",
  },
  anvil_unreachable: {
    title: "Anvil couldn't be reached",
    body: "The gateway could not reach Anvil to submit the publish job, so nothing was published.",
  },
  sbatch_rejected: {
    title: "Anvil refused the publish job",
    body: "SLURM refused the publish job when the gateway submitted it, so nothing was published.",
  },
  internal_error: {
    title: "The publish failed unexpectedly",
    body: "The gateway hit a problem while it submitted the publish job, and anything it had started on Anvil was cancelled.",
  },
};

/** A publish failure this frontend has no wording for (the backend gained a
 *  cause first). The card shows this title and the failure's own `message`. */
export const UNKNOWN_PUBLISH_FAILURE_COPY: PublishFailureCopy = {
  title: "The publish ended with a problem",
  body: "The snapshot was not published, in a way this page has no wording for.",
};

/** The copy for a failed publish: its cause's, else the unknown one. The one
 *  lookup: never index `PUBLISH_FAILURE_COPY` by a cause from the backend. */
export function publishFailureCopyFor(failure: Pick<PublishFailure, "cause"> | null | undefined): PublishFailureCopy {
  if (!failure) return UNKNOWN_PUBLISH_FAILURE_COPY;
  return (
    (Object.hasOwn(PUBLISH_FAILURE_COPY, failure.cause) ? PUBLISH_FAILURE_COPY[failure.cause] : undefined) ??
    UNKNOWN_PUBLISH_FAILURE_COPY
  );
}

/** The line under a failed publish that says what may be done, by its `retry`. */
export const PUBLISH_RETRY_COPY: Record<PublishRetry, string> = {
  same: "Trying again continues under the same snapshot id.",
  edit: "Edit the description and publish again.",
  none: "There is nothing you can retry. An administrator has to look at this.",
};
