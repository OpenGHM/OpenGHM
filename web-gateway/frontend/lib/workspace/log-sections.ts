/**
 * The rows of the Logs box, as data. The three Anvil files carry no shared
 * timestamps, so they cannot be interleaved: they are laid end to end in the
 * order they happen. A line is shown exactly as it was written; colour is the
 * only thing added to it, and a long run of file-counter lines is folded on
 * screen (`foldProgress`) but never in the text Copy takes. All of it is pure
 * and tested.
 */
import type { LogStream } from "@/lib/jobs/types";
import { displayLines, type LogText } from "@/lib/workspace/log-lines";
import { lineSeverity, type LineSeverity } from "@/lib/workspace/log-severity";

/** Where the backend's failure excerpt turns from stderr to WBM's log: it
 *  mirrors `_WBM_LOG_SEPARATOR` in `web-gateway/backend/app/services/job_verdict.py`. */
const EXCERPT_LOG_SEPARATOR = "--- last lines of WBM's log ---";

export interface LineRow {
  kind: "line";
  /** The line's number in the file, counting dropped lines. */
  number: number;
  text: string;
  severity: LineSeverity | null;
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

export type LogRow = LineRow | SeparatorRow | NoteRow;

/** The lines of a log, numbered as in the file and classified. */
export function lineRows(text: LogText): LineRow[] {
  return displayLines(text).map((line, i) => ({
    kind: "line",
    number: text.dropped + i + 1,
    text: line,
    severity: lineSeverity(line),
  }));
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

/** stderr's lines that are the failure's reason, in red. Only lines that were
 *  plain: a warning keeps its tone. Colour only: the text is never changed. */
export function markReason(rows: LineRow[], reason: Set<string>): LineRow[] {
  if (reason.size === 0) return rows;
  return rows.map((row) =>
    row.severity === null && reason.has(row.text.trim()) ? { ...row, severity: "error" } : row
  );
}

/** What Copy puts on the clipboard: the box's text, one row to a line. */
export function rowsToText(rows: LogRow[]): string {
  return rows.map((row) => row.text).join("\n");
}

/** The fetch's counter, `  1000/32959 files`: a line that says the same thing
 *  as the one before it. Older toolkit installs print it to a log, one line per
 *  thousand files. */
export const PROGRESS_LINE = /^\s*\d+\/\d+ files\s*$/;

/** Fewer counter lines in a row than this are left alone. */
const MIN_PROGRESS_RUN = 3;

/** A run of counter lines folded into its last line. `rows` are the hidden
 *  ones, in order; the last line follows the fold as an ordinary row. `key`
 *  names the run (its block and first line number) so an expanded fold stays
 *  expanded while the log grows. */
export interface FoldedRow {
  kind: "folded";
  key: string;
  rows: LineRow[];
}

export type LogItem = LogRow | FoldedRow;

/**
 * The rows as they are drawn: each run of three or more consecutive counter
 * lines becomes a `folded` row holding all but the last, then the last line,
 * so "1000/32959 files" ... "32000/32959 files" reads as the final count and a
 * "31 progress lines hidden" mark. Line numbers are the file's: the last line
 * keeps its own. The input is not changed, and `rowsToText` of it is still the
 * whole log.
 */
export function foldProgress(rows: LogRow[]): LogItem[] {
  const out: LogItem[] = [];
  let block = "";
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.kind === "separator") block = row.text;
    if (row.kind !== "line" || !PROGRESS_LINE.test(row.text)) {
      out.push(row);
      continue;
    }
    let end = i;
    while (end + 1 < rows.length) {
      const next = rows[end + 1];
      if (next.kind !== "line" || !PROGRESS_LINE.test(next.text)) break;
      end++;
    }
    const run = rows.slice(i, end + 1) as LineRow[];
    if (run.length < MIN_PROGRESS_RUN) {
      out.push(...run);
    } else {
      out.push({ kind: "folded", key: `${block}:${run[0].number}`, rows: run.slice(0, -1) });
      out.push(run[run.length - 1]);
    }
    i = end;
  }
  return out;
}
