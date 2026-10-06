import type { FailureCause, JobFailure, JobStatus } from "@/lib/jobs/types";

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
