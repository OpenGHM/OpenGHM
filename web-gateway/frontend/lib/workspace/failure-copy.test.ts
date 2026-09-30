import { describe, expect, it } from "vitest";
import type { FailureCause } from "@/lib/jobs/types";
import {
  FAILURE_COPY,
  NEXT_STEP_COPY,
  UNRECORDED_FAILURE_COPY,
  offersNewDraft,
} from "@/lib/workspace/failure-copy";

// The backend's vocabulary (ADR 0026). A cause added there must be added here,
// and this list, in the same commit: the record below will not compile without it.
const ALL_CAUSES: Record<FailureCause, true> = {
  fetch_failed: true,
  run_refused: true,
  wbm_error: true,
  wbm_silent_failure: true,
  timeout: true,
  out_of_memory: true,
  node_failure: true,
  cancelled_by_user: true,
  cancelled_by_system: true,
  lost: true,
  outcome_missing: true,
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

  it("tells a timeout to pick a longer walltime", () => {
    expect(FAILURE_COPY.timeout.nextStep).toBe("resubmit_longer_walltime");
    expect(NEXT_STEP_COPY.resubmit_longer_walltime).toMatch(/longer walltime/);
  });

  it("offers a new draft for every step except none", () => {
    expect(offersNewDraft("none")).toBe(false);
    expect(offersNewDraft("resubmit")).toBe(true);
    expect(offersNewDraft("contact_admin")).toBe(true);
  });
});
