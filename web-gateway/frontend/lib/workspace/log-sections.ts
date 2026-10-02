/**
 * The "All" view of a job's logs, as data. The three Anvil files carry no
 * shared timestamps, so they cannot be interleaved: they are stacked by source
 * in the order they happen. stderr is cut in two at the job body's marker, and
 * the download counter lines collapse into one. All of it is pure and tested.
 */
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

/** How many lines of context "Show only errors" keeps around an error. */
export const ERROR_CONTEXT_LINES = 2;

export interface LineRow {
  kind: "line";
  /** The line's number in the file, counting dropped lines. */
  number: number;
  text: string;
  severity: LineSeverity | null;
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

/** Lines left out by "Show only errors". */
export interface GapRow {
  kind: "gap";
  hidden: number;
}

export type LogRow = LineRow | SummaryRow | GapRow;

/** The lines of a log, numbered as in the file and classified. */
export function lineRows(text: LogText): LineRow[] {
  return displayLines(text).map((line, i) => ({
    kind: "line",
    number: text.dropped + i + 1,
    text: line,
    severity: lineSeverity(line),
  }));
}

export interface StderrSplit {
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

/** The rows within `context` rows of an error row, with a gap row where
 *  others were left out. No error: nothing. */
export function onlyErrorRows(rows: LogRow[], context: number = ERROR_CONTEXT_LINES): LogRow[] {
  const keep = new Set<number>();
  rows.forEach((row, i) => {
    if (row.kind !== "line" || row.severity !== "error") return;
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) keep.add(j);
  });
  const out: LogRow[] = [];
  let hidden = 0;
  rows.forEach((row, i) => {
    if (keep.has(i)) {
      if (hidden > 0) out.push({ kind: "gap", hidden });
      hidden = 0;
      out.push(row);
    } else {
      hidden += row.kind === "summary" ? row.lines : 1;
    }
  });
  if (hidden > 0 && keep.size > 0) out.push({ kind: "gap", hidden });
  return out;
}

export const errorCount = (rows: LogRow[]): number =>
  rows.reduce((n, row) => n + (row.kind === "line" && row.severity === "error" ? 1 : 0), 0);

/** How many lines the rows stand for, a gap's hidden ones left out. */
export const lineCount = (rows: LogRow[]): number =>
  rows.reduce((n, row) => n + (row.kind === "line" ? 1 : row.kind === "summary" ? row.lines : 0), 0);

export type SectionId = "setup" | "stdout" | "wbm" | "messages";

/** The key of a section's error line: `setup:12`. Unique within the All view. */
export const errorKey = (section: SectionId, number: number): string => `${section}:${number}`;

/** Every error line in the sections, in the order they are shown. */
export function errorKeys(sections: { id: SectionId; rows: LogRow[] }[]): string[] {
  const keys: string[] = [];
  for (const section of sections) {
    for (const row of section.rows) {
      if (row.kind === "line" && row.severity === "error") keys.push(errorKey(section.id, row.number));
    }
  }
  return keys;
}

/** The error to show next: the first when none is on show, and the first
 *  again after the last. -1 when there are none. */
export function nextErrorIndex(current: number | null, count: number): number {
  if (count === 0) return -1;
  return current === null ? 0 : (current + 1) % count;
}

/** What Copy puts on the clipboard for one section. */
export function rowsToText(rows: LogRow[]): string {
  return rows
    .map((row) => (row.kind === "gap" ? `... ${row.hidden} lines hidden ...` : row.text))
    .join("\n");
}
