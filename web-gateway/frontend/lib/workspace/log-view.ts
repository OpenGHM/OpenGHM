/**
 * Which log to open first, and what to say when a log has no text. The words
 * and the choice are pure so they are tested.
 */
import type { FailureCause, FilesState, JobFailure, JobStatus, LogStream } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";

/** Tab order and labels: WBM's own log first. */
export const LOG_STREAMS: readonly { stream: LogStream; label: string; noun: string }[] = [
  { stream: "wbm", label: "WBM log", noun: "WBM log" },
  { stream: "stdout", label: "Output", noun: "output" },
  { stream: "stderr", label: "Errors", noun: "error output" },
];

const STDERR_CAUSES: ReadonlySet<FailureCause> = new Set([
  "fetch_failed",
  "run_refused",
  "outcome_missing",
  "lost",
  "node_failure",
  "timeout",
  "out_of_memory",
  "cancelled_by_user",
  "cancelled_by_system",
]);

/** The log most likely to say what happened. A verdict decides first: a failure
 *  before WBM started is in stderr, a WBM failure is in its own log. Without
 *  one, a job that is running or done opens WBM's log. */
export function defaultLogStream(
  status: JobStatus,
  failure: Pick<JobFailure, "cause"> | null | undefined
): LogStream {
  if (failure) {
    if (STDERR_CAUSES.has(failure.cause)) return "stderr";
    if (failure.cause === "wbm_error" || failure.cause === "wbm_silent_failure") return "wbm";
  }
  if (status === "RUNNING" || status === "COMPLETING" || status === "COMPLETED") return "wbm";
  return "stdout";
}

/** Whether the job is at a point where its logs can exist. */
export function logsReadable(status: JobStatus): boolean {
  return status !== "DRAFT" && status !== "PENDING" && status !== "SUBMITTED";
}

/** What to show where the text would be, or `null` when there is text. */
export function logEmptyMessage(input: {
  status: JobStatus;
  files: FilesState | null;
  stream: LogStream;
  /** The file is there and has bytes in it. */
  hasText: boolean;
  exists: boolean;
}): string | null {
  const { status, files, stream, hasText, exists } = input;
  if (hasText) return null;
  if (status === "PENDING" || status === "SUBMITTED") {
    return "Logs appear here once SLURM starts the job.";
  }
  if (files === "purged" && !exists) return "Anvil purged this job's files after 30 days untouched.";
  const noun = LOG_STREAMS.find((s) => s.stream === stream)?.noun ?? "output";
  if (isTerminalStatus(status)) return `This job wrote no ${noun}.`;
  if (!exists && stream === "wbm") {
    return "WBM hasn't started writing its log yet. It starts after the model snapshot is fetched.";
  }
  return "Nothing written yet.";
}
