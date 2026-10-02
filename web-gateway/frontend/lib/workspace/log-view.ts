/**
 * Which log to open first, and what to say when a log has no text. The words
 * and the choice are pure so they are tested.
 */
import type { FailureCause, FilesState, JobStatus, LogStream } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";
import { isEmptyText } from "@/lib/workspace/log-lines";
import type { StreamState } from "@/lib/workspace/log-stream";

/** Tab order and labels: WBM's own log first. */
export const LOG_STREAMS: readonly { stream: LogStream; label: string; noun: string }[] = [
  { stream: "wbm", label: "WBM log", noun: "WBM log" },
  { stream: "stdout", label: "Output", noun: "output" },
  { stream: "stderr", label: "Errors", noun: "error output" },
];

/** A stream with nothing to show: it was read without an error, and the file is
 *  missing or empty. A stream not read yet, or one whose read failed, is not
 *  blank: its own state (loading, or the error) is what the reader should see. */
export function blankStreams(states: Record<LogStream, StreamState>): Partial<Record<LogStream, boolean>> {
  const blank: Partial<Record<LogStream, boolean>> = {};
  for (const { stream } of LOG_STREAMS) {
    const s = states[stream];
    blank[stream] = s.loaded && !s.error && isEmptyText(s.text);
  }
  return blank;
}

/**
 * The log to open on until the person picks one. A job that is still going
 * keeps today's choice: WBM's log once it runs, Output before. An ended job
 * (finished, failed or cancelled) opens on the first of WBM's log and Output
 * that has something in it, and on Errors only when neither does: stderr holds
 * little but the job script's own noise, and a job SLURM kills for memory or
 * time writes nothing to it. A stream that failed to load is not skipped (see
 * `blankStreams`), so its error shows rather than another tab.
 */
export function defaultLogStream(
  status: JobStatus,
  blank: Partial<Record<LogStream, boolean>> = {}
): LogStream {
  if (isTerminalStatus(status)) {
    if (!blank.wbm) return "wbm";
    if (!blank.stdout) return "stdout";
    return "stderr";
  }
  return status === "RUNNING" || status === "COMPLETING" ? "wbm" : "stdout";
}

/** Causes where SLURM ended the job from outside, so it never wrote to stderr. */
const SLURM_STOPPED: ReadonlySet<FailureCause> = new Set(["out_of_memory", "timeout"]);

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
  /** Why the job ended, for the one stream where an empty file misleads. */
  failure?: { cause: FailureCause; excerpt: string | null } | null;
  /** WBM's log has something in it, or has not been read yet. False only when
   *  it is known to be missing or empty. */
  wbmLog?: boolean;
}): string | null {
  const { status, files, stream, hasText, exists, failure, wbmLog = true } = input;
  if (hasText) return null;
  if (status === "PENDING" || status === "SUBMITTED") {
    return "Logs appear here once SLURM starts the job.";
  }
  if (files === "purged" && !exists) return "Anvil purged this job's files after 30 days untouched.";
  if (stream === "stderr" && isTerminalStatus(status) && failure && SLURM_STOPPED.has(failure.cause)) {
    // The job was stopped from outside, so an empty Errors tab is no sign that
    // nothing went wrong.
    const seeExcerpt = failure.excerpt ? " (see the log excerpt in the failure card)" : "";
    const progress = wbmLog ? "; the WBM log shows how far it got" : "";
    return `Nothing was written to stderr. SLURM stopped this job${seeExcerpt}${progress}.`;
  }
  const noun = LOG_STREAMS.find((s) => s.stream === stream)?.noun ?? "output";
  if (isTerminalStatus(status)) return `This job wrote no ${noun}.`;
  if (!exists && stream === "wbm") {
    return "WBM hasn't started writing its log yet. It starts after the model snapshot is fetched.";
  }
  return "Nothing written yet.";
}
