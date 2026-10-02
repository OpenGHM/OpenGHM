import { describe, expect, it } from "vitest";
import type { FailureCause, JobStatus, LogStream } from "@/lib/jobs/types";
import { appendText, EMPTY_LOG_TEXT } from "@/lib/workspace/log-lines";
import { INITIAL_STREAM, type StreamState } from "@/lib/workspace/log-stream";
import { blankStreams, defaultLogStream, logEmptyMessage, logsReadable } from "@/lib/workspace/log-view";

describe("defaultLogStream", () => {
  const ENDED: JobStatus[] = ["FAILED", "CANCELLED", "COMPLETED"];

  it.each(ENDED)("opens the WBM log of a %s job, even before anything has been read", (status) => {
    expect(defaultLogStream(status)).toBe("wbm");
    expect(defaultLogStream(status, { wbm: false })).toBe("wbm");
    expect(defaultLogStream(status, { wbm: false, stdout: true, stderr: false })).toBe("wbm");
  });

  it.each(ENDED)("opens Output of a %s job whose WBM log is missing or empty", (status) => {
    expect(defaultLogStream(status, { wbm: true })).toBe("stdout");
    expect(defaultLogStream(status, { wbm: true, stdout: false })).toBe("stdout");
  });

  it.each(ENDED)("opens Errors of a %s job only when there is nothing else", (status) => {
    expect(defaultLogStream(status, { wbm: true, stdout: true })).toBe("stderr");
    expect(defaultLogStream(status, { wbm: true, stdout: true, stderr: true })).toBe("stderr");
  });

  it.each<JobStatus>(["RUNNING", "COMPLETING"])("keeps the WBM log for a %s job, whatever was read", (status) => {
    expect(defaultLogStream(status)).toBe("wbm");
    expect(defaultLogStream(status, { wbm: true, stdout: true })).toBe("wbm");
  });

  it.each<JobStatus>(["PENDING", "SUBMITTED", "DRAFT"])("keeps Output for a %s job", (status) => {
    expect(defaultLogStream(status)).toBe("stdout");
  });
});

describe("blankStreams", () => {
  const read = (text: string, over: Partial<StreamState> = {}): StreamState => ({
    ...INITIAL_STREAM,
    loaded: true,
    exists: true,
    text: appendText(EMPTY_LOG_TEXT, text),
    ...over,
  });
  const states = (over: Partial<Record<LogStream, StreamState>>): Record<LogStream, StreamState> => ({
    wbm: INITIAL_STREAM,
    stdout: INITIAL_STREAM,
    stderr: INITIAL_STREAM,
    ...over,
  });

  it("is blank for a log that is missing or empty once read", () => {
    const blank = blankStreams(states({ wbm: { ...INITIAL_STREAM, loaded: true }, stdout: read("") }));
    expect(blank).toEqual({ wbm: true, stdout: true, stderr: false });
  });

  it("is not blank for a log with text, one not read yet, or one whose read failed", () => {
    const blank = blankStreams(
      states({ wbm: read("line\n"), stdout: INITIAL_STREAM, stderr: { ...INITIAL_STREAM, loaded: true, error: "x" } })
    );
    expect(blank).toEqual({ wbm: false, stdout: false, stderr: false });
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
      "WBM hasn't started writing its log yet. It starts after the model snapshot is fetched."
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

  describe("an empty Errors tab after SLURM stopped the job", () => {
    const stderr = { ...base, status: "FAILED", stream: "stderr" } as const;
    const stopped = (cause: FailureCause, excerpt: string | null = "x") => ({ cause, excerpt });

    it.each<FailureCause>(["out_of_memory", "timeout"])("does not read like nothing went wrong for %s", (cause) => {
      expect(logEmptyMessage({ ...stderr, exists: true, failure: stopped(cause) })).toBe(
        "Nothing was written to stderr. SLURM stopped this job (see the log excerpt in the failure card); the WBM log shows how far it got."
      );
    });

    it("drops the pointer to the excerpt when the card has none", () => {
      expect(logEmptyMessage({ ...stderr, failure: stopped("out_of_memory", null) })).toBe(
        "Nothing was written to stderr. SLURM stopped this job; the WBM log shows how far it got."
      );
    });

    it("does not send the reader to a WBM log known to be missing", () => {
      expect(logEmptyMessage({ ...stderr, failure: stopped("timeout"), wbmLog: false })).toBe(
        "Nothing was written to stderr. SLURM stopped this job (see the log excerpt in the failure card)."
      );
    });

    it.each<FailureCause>([
      "fetch_failed",
      "run_refused",
      "wbm_error",
      "wbm_silent_failure",
      "node_failure",
      "lost",
      "outcome_missing",
      "cancelled_by_user",
      "cancelled_by_system",
    ])("keeps today's words for %s", (cause) => {
      expect(logEmptyMessage({ ...stderr, failure: stopped(cause) })).toBe("This job wrote no error output.");
    });

    it("keeps today's words for the other streams, and for a job with no verdict", () => {
      const failure = stopped("out_of_memory");
      expect(logEmptyMessage({ ...stderr, stream: "stdout", failure })).toBe("This job wrote no output.");
      expect(logEmptyMessage({ ...stderr, stream: "wbm", failure })).toBe("This job wrote no WBM log.");
      expect(logEmptyMessage({ ...stderr, failure: null })).toBe("This job wrote no error output.");
    });

    it("still says Anvil purged the files", () => {
      expect(logEmptyMessage({ ...stderr, files: "purged", failure: stopped("timeout") })).toBe(
        "Anvil purged this job's files after 30 days untouched."
      );
    });

    it("says nothing when there is text", () => {
      expect(logEmptyMessage({ ...stderr, hasText: true, exists: true, failure: stopped("timeout") })).toBeNull();
    });
  });

  it("says Anvil purged the files", () => {
    expect(logEmptyMessage({ ...base, status: "COMPLETED", files: "purged" })).toBe(
      "Anvil purged this job's files after 30 days untouched."
    );
  });
});
