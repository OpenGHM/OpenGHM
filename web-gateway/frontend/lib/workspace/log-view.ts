/**
 * The tabs of the Logs panel, and what to say when a log has no text. The words
 * are pure so they are tested.
 */
import type { FailureCause, FilesState, JobStatus, LogStream } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";
import { isEmptyText } from "@/lib/workspace/log-lines";
import type { StreamState } from "@/lib/workspace/log-stream";

/** The sources, in the order they are read and listed. */
export const LOG_STREAMS: readonly { stream: LogStream; label: string; noun: string; caption: string }[] = [
  {
    stream: "wbm",
    label: "WBM log",
    noun: "WBM log",
    caption: "The model's own log, written while it runs.",
  },
  {
    stream: "stdout",
    label: "Job output",
    noun: "output",
    caption:
      "What the job script printed: the toolkit version, the snapshot, model input and image it used, and how many files it downloaded.",
  },
  {
    stream: "stderr",
    label: "Messages",
    noun: "messages",
    caption:
      "Everything the job script wrote to stderr: setup messages and download progress appear here too. It is not a list of errors.",
  },
];

/** A tab of the Logs panel: the three sources together, or one of them. */
export type LogTab = "all" | LogStream;

export const ALL_TAB = {
  tab: "all" as const,
  label: "All",
  caption:
    "All three logs in one place. Shown by source, not by time: the files carry no timestamps to put them in order. Error lines are marked in red.",
};

/** The streams a tab reads, in reading order. */
export function streamsForTab(tab: LogTab): readonly LogStream[] {
  return tab === "all" ? LOG_STREAMS.map((s) => s.stream) : [tab];
}

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
  /** For `stderr` in the All view: it has text, but all of it is setup
   *  messages, so "nothing after them" is the true statement. */
  afterSetup?: boolean;
}): string | null {
  const { status, files, stream, hasText, exists, failure, wbmLog = true, afterSetup = false } = input;
  if (hasText) return null;
  if (status === "PENDING" || status === "SUBMITTED") {
    return "Logs appear here once SLURM starts the job.";
  }
  if (files === "purged" && !exists) return "Anvil purged this job's files after 30 days untouched.";
  if (stream === "stderr" && isTerminalStatus(status) && failure && SLURM_STOPPED.has(failure.cause)) {
    // The job was stopped from outside, so an empty Messages tab is no sign
    // that nothing went wrong.
    const seeExcerpt = failure.excerpt ? " (see the log excerpt in the failure card)" : "";
    const progress = wbmLog ? "; the WBM log shows how far it got" : "";
    const nothing = afterSetup ? "Nothing was written after the setup messages." : "Nothing was written to stderr.";
    return `${nothing} SLURM stopped this job${seeExcerpt}${progress}.`;
  }
  const noun = LOG_STREAMS.find((s) => s.stream === stream)?.noun ?? "output";
  if (isTerminalStatus(status)) return `This job wrote no ${noun}.`;
  if (!exists && stream === "wbm") {
    return "WBM hasn't started writing its log yet. It starts after the model snapshot is fetched.";
  }
  return "Nothing written yet.";
}
