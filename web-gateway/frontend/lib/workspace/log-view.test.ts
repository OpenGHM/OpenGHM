import { describe, expect, it } from "vitest";
import type { FailureCause, JobStatus } from "@/lib/jobs/types";
import { defaultLogStream, logEmptyMessage, logsReadable } from "@/lib/workspace/log-view";

describe("defaultLogStream", () => {
  it.each<FailureCause>([
    "fetch_failed",
    "run_refused",
    "outcome_missing",
    "lost",
    "node_failure",
    "timeout",
    "out_of_memory",
    "cancelled_by_user",
    "cancelled_by_system",
  ])("opens Errors for %s", (cause) => {
    expect(defaultLogStream("FAILED", { cause })).toBe("stderr");
  });

  it.each<FailureCause>(["wbm_error", "wbm_silent_failure"])("opens the WBM log for %s", (cause) => {
    expect(defaultLogStream("FAILED", { cause })).toBe("wbm");
  });

  it.each<JobStatus>(["RUNNING", "COMPLETING", "COMPLETED"])("opens the WBM log for %s", (status) => {
    expect(defaultLogStream(status, null)).toBe("wbm");
  });

  it.each<JobStatus>(["PENDING", "SUBMITTED", "FAILED", "CANCELLED", "DRAFT"])(
    "opens Output for %s without a verdict",
    (status) => {
      expect(defaultLogStream(status, null)).toBe("stdout");
    }
  );

  it("lets the verdict win over the status", () => {
    expect(defaultLogStream("COMPLETED", { cause: "outcome_missing" })).toBe("stderr");
  });
});

describe("logsReadable", () => {
  it("is false until SLURM has started the job", () => {
    expect(logsReadable("PENDING")).toBe(false);
    expect(logsReadable("SUBMITTED")).toBe(false);
    expect(logsReadable("RUNNING")).toBe(true);
    expect(logsReadable("FAILED")).toBe(true);
  });
});

describe("logEmptyMessage", () => {
  const base = { files: null, stream: "wbm", hasText: false, exists: false } as const;

  it("says nothing when there is text", () => {
    expect(logEmptyMessage({ ...base, status: "RUNNING", hasText: true, exists: true })).toBeNull();
  });

  it("says logs come when SLURM starts the job", () => {
    expect(logEmptyMessage({ ...base, status: "PENDING" })).toBe("Logs appear here once SLURM starts the job.");
    expect(logEmptyMessage({ ...base, status: "SUBMITTED", stream: "stdout" })).toBe(
      "Logs appear here once SLURM starts the job."
    );
  });

  it("explains a WBM log that is not written yet", () => {
    expect(logEmptyMessage({ ...base, status: "RUNNING" })).toBe(
      "WBM hasn't started writing its log yet. It starts after the snapshot is fetched."
    );
  });

  it("says nothing was written yet for SLURM's streams and for an empty file", () => {
    expect(logEmptyMessage({ ...base, status: "RUNNING", stream: "stdout" })).toBe("Nothing written yet.");
    expect(logEmptyMessage({ ...base, status: "RUNNING", stream: "stderr" })).toBe("Nothing written yet.");
    expect(logEmptyMessage({ ...base, status: "RUNNING", exists: true })).toBe("Nothing written yet.");
  });

  it("says what an ended job wrote no", () => {
    expect(logEmptyMessage({ ...base, status: "COMPLETED", stream: "stderr" })).toBe(
      "This job wrote no error output."
    );
    expect(logEmptyMessage({ ...base, status: "FAILED", stream: "stdout" })).toBe("This job wrote no output.");
    expect(logEmptyMessage({ ...base, status: "FAILED", stream: "wbm" })).toBe("This job wrote no WBM log.");
  });

  it("says Anvil purged the files", () => {
    expect(logEmptyMessage({ ...base, status: "COMPLETED", files: "purged" })).toBe(
      "Anvil purged this job's files after 30 days untouched."
    );
  });
});
