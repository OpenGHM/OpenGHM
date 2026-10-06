import { describe, expect, it } from "vitest";
import type { FailureCause } from "@/lib/jobs/types";
import { logsReadable, stoppedMessage } from "@/lib/workspace/log-view";

describe("logsReadable", () => {
  it("is false until SLURM has started the job", () => {
    expect(logsReadable("PENDING")).toBe(false);
    expect(logsReadable("SUBMITTED")).toBe(false);
    expect(logsReadable("RUNNING")).toBe(true);
    expect(logsReadable("FAILED")).toBe(true);
  });
});

describe("stoppedMessage", () => {
  const base = { status: "FAILED", wbmLog: true } as const;
  const stopped = (cause: FailureCause, excerpt: string | null = "x") => ({ cause, excerpt });

  it.each<FailureCause>(["out_of_memory", "timeout"])("does not read like nothing went wrong for %s", (cause) => {
    expect(stoppedMessage({ ...base, failure: stopped(cause) })).toBe(
      "Nothing was written to stderr. SLURM stopped this job (see the log excerpt in the failure card); the WBM log shows how far it got."
    );
  });

  it("drops the pointer to the excerpt when the card has none", () => {
    expect(stoppedMessage({ ...base, failure: stopped("out_of_memory", null) })).toBe(
      "Nothing was written to stderr. SLURM stopped this job; the WBM log shows how far it got."
    );
  });

  it("does not send the reader to a WBM log known to be missing", () => {
    expect(stoppedMessage({ ...base, failure: stopped("timeout"), wbmLog: false })).toBe(
      "Nothing was written to stderr. SLURM stopped this job (see the log excerpt in the failure card)."
    );
  });

  it.each<FailureCause>([
    "fetch_failed",
    "gateway_setup",
    "run_refused",
    "wbm_error",
    "wbm_silent_failure",
    "node_failure",
    "lost",
    "outcome_missing",
    "cancelled_by_user",
    "cancelled_by_system",
  ])("says nothing for %s", (cause) => {
    expect(stoppedMessage({ ...base, failure: stopped(cause) })).toBeNull();
  });

  it("says nothing for a job with no verdict, or one still going", () => {
    expect(stoppedMessage({ ...base, failure: null })).toBeNull();
    expect(stoppedMessage({ ...base, status: "RUNNING", failure: stopped("out_of_memory") })).toBeNull();
  });
});
