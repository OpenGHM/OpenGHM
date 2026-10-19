import { describe, expect, it } from "vitest";
import type { FailureCause, JobFailure, PublishFailureCause, PublishRetry } from "@/lib/jobs/types";
import { fakePublish } from "@/lib/workspace/fixtures";
import {
  FAILURE_COPY,
  NEXT_STEP_COPY,
  PUBLISH_FAILURE_COPY,
  PUBLISH_RETRY_COPY,
  UNKNOWN_FAILURE_COPY,
  UNKNOWN_PUBLISH_FAILURE_COPY,
  UNRECORDED_FAILURE_COPY,
  failureCopyFor,
  offersNewDraft,
  publishFailureCopyFor,
  summaryOffersCopy,
} from "@/lib/workspace/failure-copy";

// The backend's vocabulary (ADR 0026). A cause added there must be added here,
// and this list, in the same commit: the record below will not compile without it.
const ALL_CAUSES: Record<FailureCause, true> = {
  fetch_failed: true,
  gateway_setup: true,
  run_refused: true,
  wbm_error: true,
  post_processing_failed: true,
  wbm_silent_failure: true,
  timeout: true,
  out_of_memory: true,
  node_failure: true,
  cancelled_by_user: true,
  cancelled_by_system: true,
  lost: true,
  outcome_missing: true,
  continuation_failed: true,
  run_state_incomplete: true,
  run_incomplete: true,
};

describe("FAILURE_COPY", () => {
  it.each(Object.keys(ALL_CAUSES) as FailureCause[])("has plain copy for %s", (cause) => {
    const copy = FAILURE_COPY[cause];
    expect(copy).toBeDefined();
    expect(copy.title.length).toBeGreaterThan(0);
    expect(copy.body.length).toBeGreaterThan(0);
    expect(["danger", "warning", "neutral"]).toContain(copy.tone);
    expect(Object.keys(NEXT_STEP_COPY)).toContain(copy.nextStep);
  });

  it("has no entry for a cause the backend does not name", () => {
    expect(Object.keys(FAILURE_COPY).sort()).toEqual(Object.keys(ALL_CAUSES).sort());
  });

  it("never leaks internal words to the user", () => {
    for (const copy of Object.values(FAILURE_COPY)) {
      for (const text of [copy.title, copy.body]) {
        expect(text).not.toMatch(/not wired|illustrative|slurmly|sbatch|outcome\.json/i);
      }
    }
  });

  it("has a body that stands on its own, as the fallback for a missing message", () => {
    for (const copy of [...Object.values(FAILURE_COPY), UNRECORDED_FAILURE_COPY]) {
      expect(copy.body).not.toMatch(/\b(below|above)\b/i);
    }
    for (const text of Object.values(NEXT_STEP_COPY)) {
      expect(text).not.toMatch(/\b(below|above)\b/i);
    }
  });

  it("tells a timeout to try a shorter run period, never a longer walltime (nobody sets one)", () => {
    expect(FAILURE_COPY.timeout.nextStep).toBe("new_draft");
    expect(FAILURE_COPY.timeout.body).toMatch(/shorter run period/);
    expect(FAILURE_COPY.timeout.body).not.toMatch(/longer walltime/);
  });

  it("does not suggest a smaller spatial domain for running out of memory: more cores or a shorter run period", () => {
    const { body } = FAILURE_COPY.out_of_memory;
    expect(body).not.toMatch(/spatial domain|smaller/i);
    expect(body).toMatch(/more cores/);
    expect(body).toMatch(/1\.9 GB/);
    expect(body).toMatch(/shorter run period/);
  });

  it("says gateway_setup is Anvil's setup, for an administrator, not the snapshot's download", () => {
    const copy = FAILURE_COPY.gateway_setup;
    expect(copy.title).toBe("Anvil isn't set up correctly for OpenGHM");
    expect(copy.body).toMatch(/snapshot is not at fault/);
    expect(copy.nextStep).toBe("admin_fixes_setup");
    expect(NEXT_STEP_COPY.admin_fixes_setup).toMatch(/administrator has to fix the gateway's Anvil setup/);
    expect(NEXT_STEP_COPY.admin_fixes_setup).toMatch(/can be tried again/);
    expect(NEXT_STEP_COPY.admin_fixes_setup).not.toMatch(/new draft/);
    expect(offersNewDraft(copy.nextStep)).toBe(true);
    expect(summaryOffersCopy("FAILED", { cause: "gateway_setup", phase: "fetch", message: "m", excerpt: null })).toBe(true);
  });

  it("says post_processing_failed finished WBM's run and names the post-processing, not the run, as what failed", () => {
    const copy = FAILURE_COPY.post_processing_failed;
    expect(copy.title).toMatch(/post-processing/i);
    expect(copy.body).toMatch(/daily, monthly and yearly output is complete/);
    expect(copy.body).toMatch(/climatology/);
    expect(copy.body).toMatch(/Submitting again/);
    expect(copy.nextStep).toBe("resubmit");
    expect(copy.tone).toBe("danger");
  });

  it("words the three causes of a run continued in several jobs (ADR 0037)", () => {
    expect(FAILURE_COPY.continuation_failed.title).toBe("The next job couldn't be submitted");
    expect(FAILURE_COPY.continuation_failed.body).toMatch(/time limit/);
    expect(FAILURE_COPY.continuation_failed.nextStep).toBe("contact_admin");
    expect(FAILURE_COPY.run_state_incomplete.title).toBe("The saved run state is incomplete");
    expect(FAILURE_COPY.run_state_incomplete.nextStep).toBe("resubmit");
    expect(FAILURE_COPY.run_incomplete.title).toBe("WBM stopped before the end of the run");
    expect(FAILURE_COPY.run_incomplete.tone).toBe("danger");
  });

  it("offers a new draft for every step except none", () => {
    expect(offersNewDraft("none")).toBe(false);
    expect(offersNewDraft("admin_fixes_setup")).toBe(true);
    expect(offersNewDraft("resubmit")).toBe(true);
    expect(offersNewDraft("contact_admin")).toBe(true);
  });

  it("has the copy action in the summary of a cancelled job and of a failed one that offers a new draft, and nowhere else", () => {
    const failure = (cause: FailureCause): JobFailure => ({ cause, phase: null, message: "m", excerpt: null });
    expect(summaryOffersCopy("CANCELLED", failure("cancelled_by_user"))).toBe(true);
    expect(summaryOffersCopy("CANCELLED", null)).toBe(true);
    expect(summaryOffersCopy("FAILED", failure("wbm_error"))).toBe(true);
    expect(summaryOffersCopy("FAILED", null)).toBe(true);
    // A failed job whose cause offers nothing leaves the action to the header.
    expect(summaryOffersCopy("FAILED", failure("cancelled_by_user"))).toBe(false);
    expect(summaryOffersCopy("COMPLETED", null)).toBe(false);
    expect(summaryOffersCopy("RUNNING", null)).toBe(false);
  });
});

describe("failureCopyFor", () => {
  const failure = (cause: string) => ({ cause: cause as FailureCause, phase: null, message: "m", excerpt: null });

  it("is the cause's copy for a known cause, and the unrecorded copy without a verdict", () => {
    expect(failureCopyFor(failure("timeout"))).toBe(FAILURE_COPY.timeout);
    expect(failureCopyFor(null)).toBe(UNRECORDED_FAILURE_COPY);
  });

  it("tells a timeout that used all its time to shorten the run, in time and not in jobs", () => {
    const used = failureCopyFor({ cause: "timeout", detail: "job_limit" });
    expect(used.title).toBe(FAILURE_COPY.timeout.title);
    expect(used.body).toMatch(/used all the time one simulation may have/);
    expect(used.body).not.toMatch(/\bjobs?\b/);
    expect(used.body).toMatch(/shorter run period/);
    expect(used.nextStep).toBe("new_draft");
    // A job that saved no new state, and a verdict without a detail, read as a timeout always did.
    expect(failureCopyFor({ cause: "timeout", detail: "no_new_state" })).toBe(FAILURE_COPY.timeout);
    expect(failureCopyFor({ cause: "timeout", detail: null })).toBe(FAILURE_COPY.timeout);
  });

  it("is a generic copy, not undefined, for a cause the frontend does not know", () => {
    expect(failureCopyFor(failure("brand_new_cause"))).toBe(UNKNOWN_FAILURE_COPY);
    // Inherited object keys are not causes either.
    expect(failureCopyFor(failure("constructor"))).toBe(UNKNOWN_FAILURE_COPY);
    expect(UNKNOWN_FAILURE_COPY.title.length).toBeGreaterThan(0);
  });

  it("lets the summary offer the copy action for an unknown cause", () => {
    expect(summaryOffersCopy("FAILED", failure("brand_new_cause"))).toBe(true);
  });
});

// The backend's vocabulary for a failed publish (`PublishFailureCause` in
// app/models/job.py): the cause and the retry the backend gives it. A cause
// added there must be added here, and the record will not compile without it.
const ALL_PUBLISH_CAUSES: Record<PublishFailureCause, PublishRetry> = {
  publish_bad_input: "edit",
  publish_output_incomplete: "none",
  publish_conflict: "none",
  publish_setup: "none",
  publish_upload_failed: "same",
  publish_verify_failed: "same",
  publish_job_failed: "same",
  publish_submit_interrupted: "same",
  anvil_not_configured: "same",
  anvil_unreachable: "same",
  sbatch_rejected: "same",
  internal_error: "same",
};

describe("PUBLISH_FAILURE_COPY", () => {
  it.each(Object.keys(ALL_PUBLISH_CAUSES) as PublishFailureCause[])("has plain copy for %s", (cause) => {
    const copy = PUBLISH_FAILURE_COPY[cause];
    expect(copy).toBeDefined();
    expect(copy.title.length).toBeGreaterThan(0);
    expect(copy.body.length).toBeGreaterThan(0);
    expect(copy.body).toMatch(/\.$/);
  });

  it("is previewed with the retry the backend gives each cause", () => {
    for (const [cause, retry] of Object.entries(ALL_PUBLISH_CAUSES)) {
      expect(fakePublish(cause as PublishFailureCause).failure?.retry).toBe(retry);
    }
  });

  it("has no entry for a cause the backend does not name", () => {
    expect(Object.keys(PUBLISH_FAILURE_COPY).sort()).toEqual(Object.keys(ALL_PUBLISH_CAUSES).sort());
  });

  it("never leaks internal words to the user", () => {
    for (const copy of [...Object.values(PUBLISH_FAILURE_COPY), UNKNOWN_PUBLISH_FAILURE_COPY]) {
      for (const text of [copy.title, copy.body]) {
        expect(text).not.toMatch(/s3cmd|sbatch|slurmly|stderr|outcome\.json|exit code|toolkit|openghm snapshot/i);
      }
    }
  });

  it("has a body that stands on its own and says nothing of what to do, which the retry line does", () => {
    for (const copy of Object.values(PUBLISH_FAILURE_COPY)) {
      expect(copy.body).not.toMatch(/\b(below|above)\b/i);
      expect(copy.body).not.toMatch(/try again|edit |administrator/i);
    }
  });

  it("says what each retry means, in the owner's terms", () => {
    expect(Object.keys(PUBLISH_RETRY_COPY).sort()).toEqual(["edit", "none", "same"]);
    expect(PUBLISH_RETRY_COPY.same).toMatch(/same snapshot id/);
    expect(PUBLISH_RETRY_COPY.edit).toMatch(/Edit the description/);
    expect(PUBLISH_RETRY_COPY.none).toMatch(/administrator has to look/);
  });

  it("names a failure that the upload can resume as one that keeps what it uploaded", () => {
    expect(PUBLISH_FAILURE_COPY.publish_upload_failed.body).toMatch(/already uploaded are kept/);
    expect(PUBLISH_FAILURE_COPY.publish_conflict.body).toMatch(/never overwritten/);
    expect(PUBLISH_FAILURE_COPY.publish_setup.body).toMatch(/not at fault/);
  });

  it("says in the body whether anything was uploaded, which the title does not", () => {
    expect(PUBLISH_FAILURE_COPY.publish_setup.body).toMatch(/nothing was uploaded/);
    expect(PUBLISH_FAILURE_COPY.publish_job_failed.body).toMatch(/already uploaded is kept/);
    for (const copy of Object.values(PUBLISH_FAILURE_COPY)) {
      expect(copy.body.toLowerCase()).not.toBe(copy.title.toLowerCase());
    }
  });
});

describe("publishFailureCopyFor", () => {
  const failure = (cause: string) => ({ cause: cause as PublishFailureCause });

  it("is the cause's copy for a known cause", () => {
    expect(publishFailureCopyFor(failure("publish_setup"))).toBe(PUBLISH_FAILURE_COPY.publish_setup);
  });

  it("is a generic copy, not undefined, for a cause the frontend does not know, or none", () => {
    expect(publishFailureCopyFor(failure("brand_new_cause"))).toBe(UNKNOWN_PUBLISH_FAILURE_COPY);
    expect(publishFailureCopyFor(failure("constructor"))).toBe(UNKNOWN_PUBLISH_FAILURE_COPY);
    expect(publishFailureCopyFor(null)).toBe(UNKNOWN_PUBLISH_FAILURE_COPY);
  });
});
