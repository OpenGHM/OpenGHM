/**
 * The rows of the Logs box, as data. The three Anvil files carry no shared
 * timestamps, so they cannot be interleaved: they are laid end to end in the
 * order they happen. stderr is cut in two at the job body's marker, and the
 * download counter lines collapse into one. All of it is pure and tested.
 */
import type { LogStream } from "@/lib/jobs/types";
import { displayLines, type LogText } from "@/lib/workspace/log-lines";
import { lineSeverity, type LineSeverity } from "@/lib/workspace/log-severity";

/**
 * The line the job script writes to stderr when its own body starts, after
 * slurmly's module preamble. It mirrors `BODY_MARKER` in
 * `web-gateway/backend/app/services/job_script.py`: change one and the other
 * has to change with it.
 */
export const JOB_BODY_MARKER = "== openghm gateway job body ==";

/** Where the backend's failure excerpt turns from stderr to WBM's log: it
 *  mirrors `_WBM_LOG_SEPARATOR` in `web-gateway/backend/app/services/job_verdict.py`. */
const EXCERPT_LOG_SEPARATOR = "--- last lines of WBM's log ---";

/** The toolkit's download counter: `  1000/32959 files`. */
const PROGRESS_LINE = /^\s*(\d+)\/(\d+) files\s*$/;

export interface LineRow {
  kind: "line";
  /** The line's number in the file, counting dropped lines. */
  number: number;
  text: string;
  severity: LineSeverity | null;
  /** Setup messages: shown in a dimmer tone. */
  dim?: boolean;
}

/** Several lines shown as one: the download counter. */
export interface SummaryRow {
  kind: "summary";
  /** The number of the first line it stands for. */
  number: number;
  /** How many lines it stands for. */
  lines: number;
  text: string;
}

/** The plain line that starts a source's block: `──── WBM log ────`. */
interface SeparatorRow {
  kind: "separator";
  text: string;
}

/** A line of the box's own, not from a file: a source that is missing, still
 *  loading or could not be read. `retry` names the stream a Retry button reads. */
interface NoteRow {
  kind: "note";
  text: string;
  retry?: LogStream;
}

export type LogRow = LineRow | SummaryRow | SeparatorRow | NoteRow;

/** The lines of a log, numbered as in the file and classified. */
export function lineRows(text: LogText): LineRow[] {
  return displayLines(text).map((line, i) => ({
    kind: "line",
    number: text.dropped + i + 1,
    text: line,
    severity: lineSeverity(line),
  }));
}

interface StderrSplit {
  /** What came before the marker: slurmly's module preamble. */
  setup: LineRow[];
  /** What the job script and the toolkit wrote after it. */
  body: LineRow[];
  /** The marker was in the text. */
  markerFound: boolean;
}

const isMarker = (row: LineRow) => row.text.trim() === JOB_BODY_MARKER;

/**
 * Cuts stderr at the first marker line. The marker lines themselves are left
 * out, a repeated one included. With no marker the body never started (or its
 * start fell outside the lines read), and, as in the backend's excerpt,
 * everything there is news: all of it is `body`.
 */
export function splitStderr(rows: LineRow[]): StderrSplit {
  const at = rows.findIndex(isMarker);
  if (at === -1) return { setup: [], body: rows, markerFound: false };
  return {
    setup: rows.slice(0, at),
    body: rows.slice(at + 1).filter((row) => !isMarker(row)),
    markerFound: true,
  };
}

/**
 * The reason a failed job gives, as the failure card quotes it: the last block
 * of non-blank lines of the excerpt's stderr part (the backend's
 * `_last_paragraph`). A program often states its reason in plain words with no
 * error word on the line ("Aggregation multi-year start is outside of the run
 * dates"), so the words cannot find it; the card already knows which line it is.
 */
export function failureReasonLines(excerpt: string | null | undefined): Set<string> {
  const stderrPart = (excerpt ?? "").split(EXCERPT_LOG_SEPARATOR)[0];
  const block: string[] = [];
  for (const line of stderrPart.split("\n").reverse()) {
    if (line.trim()) block.push(line.trim());
    else if (block.length > 0) break;
  }
  return new Set(block);
}

/** stderr's lines after the marker that are the failure's reason, in red. Only
 *  lines that were plain: a warning keeps its tone. */
export function markReason(rows: LineRow[], reason: Set<string>): LineRow[] {
  if (reason.size === 0) return rows;
  const at = rows.findIndex(isMarker);
  return rows.map((row, i) =>
    i > at && row.severity === null && reason.has(row.text.trim()) ? { ...row, severity: "error" } : row
  );
}

/** The toolkit's summary of a fetch that went through, on stdout
 *  (`summary_line` in `packages/openghm/src/openghm/fetch.py`). */
const FETCH_SUMMARY = /^downloaded \d+, skipped \d+, failed 0\b/;

/** How many fetches the job's output says went through. */
export function fetchesDone(stdout: LineRow[]): number {
  return stdout.filter((row) => FETCH_SUMMARY.test(row.text)).length;
}

/**
 * Each run of counter lines becomes one row. The toolkit prints a counter only
 * at every 1000 files, so the last one of a finished download is short of its
 * total ("32000/32959"): a download is done when stdout says so (`fetches`
 * counts the summaries there, one per run, in order), or when the counter
 * reached its total. A run that is not done reads "Downloading: 5000/32959
 * files" while the job is `live` and the counter is the last thing written,
 * and "Download stopped at 5000/32959 files" once nothing more is coming.
 */
export function collapseProgress(
  rows: LineRow[],
  { live, fetches = 0 }: { live: boolean; fetches?: number }
): LogRow[] {
  const out: LogRow[] = [];
  let run = 0;
  let i = 0;
  while (i < rows.length) {
    if (!PROGRESS_LINE.test(rows[i].text)) {
      out.push(rows[i++]);
      continue;
    }
    const start = i;
    while (i < rows.length && PROGRESS_LINE.test(rows[i].text)) i++;
    const [, done, total] = PROGRESS_LINE.exec(rows[i - 1].text) ?? [];
    const finished = Number(done) >= Number(total) || run < fetches;
    run++;
    const moving = live && i === rows.length;
    out.push({
      kind: "summary",
      number: rows[start].number,
      lines: i - start,
      text: finished
        ? `Downloaded ${total} files`
        : moving
          ? `Downloading: ${done}/${total} files`
          : `Download stopped at ${done}/${total} files`,
    });
  }
  return out;
}

/** What Copy puts on the clipboard: the box's text, one row to a line. */
export function rowsToText(rows: LogRow[]): string {
  return rows.map((row) => row.text).join("\n");
}
