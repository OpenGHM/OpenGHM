/**
 * What the Logs box shows: the job's three files laid end to end in the order
 * they happen (the job's output, WBM's log, then the messages), each block
 * opened by one plain separator line, each file's lines exactly as written.
 * Pure, so it is tested.
 */
import type { FilesState, JobFailure, JobStatus, LogStream } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";
import { isEmptyText, MAX_LOG_LINES } from "@/lib/workspace/log-lines";
import { failureReasonLines, lineRows, markReason, type LogRow } from "@/lib/workspace/log-sections";
import type { StreamState } from "@/lib/workspace/log-stream";
import { logsReadable, stoppedMessage } from "@/lib/workspace/log-view";
import { formatBytes } from "@/lib/workspace/format";

/** The sources, as the page names them: the download menu and the separators. */
export const LOG_SOURCES: readonly { stream: LogStream; label: string }[] = [
  { stream: "stdout", label: "Job output" },
  { stream: "wbm", label: "WBM log" },
  { stream: "stderr", label: "Messages" },
];

const sourceLabel = (stream: LogStream): string =>
  LOG_SOURCES.find((s) => s.stream === stream)?.label ?? stream;

/** A source's name, with its job when the simulation was run by several
 *  (ADR 0037): `Job output (job 2)`. WBM's log is one file across jobs, so it
 *  never names one. */
export function sourceTitle(stream: LogStream, job?: number): string {
  return job !== undefined && stream !== "wbm" ? `${sourceLabel(stream)} (job ${job})` : sourceLabel(stream);
}

const separator = (title: string): LogRow => ({ kind: "separator", text: `──── ${title} ────` });

export type LogBox =
  /** Nothing has answered yet. */
  | { kind: "loading" }
  /** No box: there is nothing to put in it. */
  | { kind: "empty"; message: string }
  | { kind: "rows"; rows: LogRow[] };

/** What the box shows for the three streams as read so far. */
export function buildLogBox(input: {
  states: Record<LogStream, StreamState>;
  status: JobStatus;
  files: FilesState | null;
  failure: Pick<JobFailure, "cause" | "excerpt"> | null;
  /** Which job's stdout and stderr these are, when the simulation has had
   *  several; named in their separators. */
  job?: number;
  /** An earlier job ran, so there are logs even before the next one starts. */
  earlierJobs?: boolean;
}): LogBox {
  const { states, status, files, failure, job, earlierJobs = false } = input;
  const all = LOG_SOURCES.map((s) => states[s.stream]);

  if (!logsReadable(status) && !earlierJobs && all.every((s) => isEmptyText(s.text))) {
    return { kind: "empty", message: "Logs appear here once SLURM starts the simulation." };
  }
  if (files === "purged" && all.every((s) => s.loaded && !s.exists)) {
    return { kind: "empty", message: "Anvil purged this simulation's files after 30 days untouched." };
  }
  if (all.every((s) => !s.loaded)) return { kind: "loading" };

  const live = !isTerminalStatus(status);
  const stdoutRows = lineRows(states.stdout.text);
  const wbmRows = lineRows(states.wbm.text);
  const reason = status === "FAILED" ? failureReasonLines(failure?.excerpt) : new Set<string>();
  const messageRows = markReason(lineRows(states.stderr.text), reason);

  /** What a source with no rows says: why, in one muted line. */
  const missing = (state: StreamState): LogRow[] => {
    if (state.error) return [];
    if (!state.loaded) return [{ kind: "note", text: "(loading…)" }];
    return [{ kind: "note", text: live ? "(no output yet)" : "(no output)" }];
  };
  const block = (stream: LogStream, rows: LogRow[], extra: LogRow[] = []): LogRow[] => {
    const state = states[stream];
    const out: LogRow[] = [separator(sourceTitle(stream, job))];
    if (state.startedMidway || state.text.dropped > 0) {
      out.push({
        kind: "note",
        text:
          state.text.dropped > 0
            ? `(showing the last ${MAX_LOG_LINES.toLocaleString("en-US")} lines of a ${formatBytes(state.size)} log; Download has the whole file)`
            : `(showing the end of a ${formatBytes(state.size)} log; Download has the whole file)`,
      });
    }
    out.push(...rows, ...extra);
    if (rows.length === 0 && extra.length === 0) out.push(...missing(state));
    if (state.error) {
      out.push({
        kind: "note",
        text: `The ${sourceLabel(stream)} could not be read: ${state.error}`,
        retry: stream,
      });
    }
    return out;
  };

  const stopped =
    messageRows.length === 0 && states.stderr.loaded && !states.stderr.error
      ? stoppedMessage({
          status,
          failure,
          wbmLog: !(states.wbm.loaded && !states.wbm.error && isEmptyText(states.wbm.text)),
        })
      : null;

  return {
    kind: "rows",
    rows: [
      ...block("stdout", stdoutRows),
      ...block("wbm", wbmRows),
      ...block("stderr", messageRows, stopped ? [{ kind: "note" as const, text: stopped }] : []),
    ],
  };
}
