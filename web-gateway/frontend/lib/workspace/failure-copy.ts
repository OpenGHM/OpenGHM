import type { FailureCause } from "@/lib/jobs/types";

/** What the person can do about it. The card turns this into a sentence
 *  (`NEXT_STEP_COPY`) and the buttons it offers. */
export type NextStep =
  | "resubmit"
  | "resubmit_longer_walltime"
  | "new_draft"
  | "contact_admin"
  | "none";

/** `danger`: something in this run's own setup. `warning`: a limit it hit.
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
 * card shows the message instead, because it names the facts of the run. So
 * `body` must read on its own, and refer to nothing shown next to it.
 */
export const FAILURE_COPY: Record<FailureCause, FailureCopy> = {
  fetch_failed: {
    title: "The model snapshot couldn't be downloaded",
    body: "The job could not fetch the model snapshot's files onto Anvil, so WBM never started.",
    nextStep: "resubmit",
    tone: "danger",
  },
  run_refused: {
    title: "The run was refused before it started",
    body: "The toolkit checked the model snapshot and this simulation's settings and refused to start WBM.",
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
    body: "The job hit its walltime before WBM finished. Anything it wrote before that may still be on Anvil.",
    nextStep: "resubmit_longer_walltime",
    tone: "warning",
  },
  out_of_memory: {
    title: "Ran out of memory",
    body: "WBM needed more memory than the job was given, and Anvil stopped it. Try a smaller spatial domain or a shorter period.",
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
    body: "This simulation was stopped at its owner's request.",
    nextStep: "none",
    tone: "neutral",
  },
  cancelled_by_system: {
    title: "Cancelled by Anvil or an administrator",
    body: "This simulation was stopped by someone other than its owner.",
    nextStep: "resubmit",
    tone: "neutral",
  },
};

/** The sentence under the body that says what to do. */
export const NEXT_STEP_COPY: Record<NextStep, string> = {
  resubmit: "Try again from a new draft with the same settings.",
  resubmit_longer_walltime:
    "Try again from a new draft with the same settings, and pick a longer walltime before you submit it.",
  new_draft:
    "Try again from a new draft, change what caused this, and submit it.",
  contact_admin:
    "Try again from a new draft. If it keeps happening, tell an administrator this simulation's ID.",
  none: "",
};

/** Whether a failed job's card offers "Try again with these settings". */
export function offersNewDraft(step: NextStep): boolean {
  return step !== "none";
}

/** A FAILED job that carries no verdict: it ended before the gateway recorded
 *  causes. The card shows the reason the job stored, if any, in place of `body`. */
export const UNRECORDED_FAILURE_COPY: FailureCopy = {
  title: "The run failed",
  body: "This job failed before the gateway recorded why. The job's logs may say more.",
  nextStep: "new_draft",
  tone: "danger",
};
