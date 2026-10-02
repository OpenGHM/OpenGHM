/**
 * The rows of the Logs box, as data. The three Anvil files carry no shared
 * timestamps, so they cannot be interleaved: they are laid end to end in the
 * order they happen. A line is shown exactly as it was written; colour is the
 * only thing added to it. All of it is pure and tested.
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
