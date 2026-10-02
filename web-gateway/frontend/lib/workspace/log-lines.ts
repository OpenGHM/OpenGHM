/**
 * A log as lines (ADR 0027). The server sends byte ranges, so a chunk can end
 * in the middle of a line: the unfinished tail is kept apart and shown as the
 * last line until the next chunk completes it. Carriage returns are collapsed
 * the way a terminal shows them, and the number of lines kept is capped.
 */

/** The most lines held; older ones are dropped and counted. */
export const MAX_LOG_LINES = 10_000;

export interface LogText {
  /** Complete lines, oldest first, carriage returns already collapsed. */
  lines: string[];
  /** Text after the last newline: a line that is not finished yet. Raw. */
  partial: string;
  /** How many lines were dropped from the front to stay under the cap. */
  dropped: number;
}

export const EMPTY_LOG_TEXT: LogText = { lines: [], partial: "", dropped: 0 };

/** What a terminal would show for one line: the text after its last `\r`.
 *  A single trailing `\r` (a `\r\n` ending) is not an overwrite. */
export function collapseCr(line: string): string {
  const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
  const i = trimmed.lastIndexOf("\r");
  return i === -1 ? trimmed : trimmed.slice(i + 1);
}

/** Add a chunk's text. Never mutates `text`. */
export function appendText(text: LogText, data: string, max: number = MAX_LOG_LINES): LogText {
  if (data === "") return text;
  const parts = (text.partial + data).split("\n");
  const partial = parts.pop() ?? "";
  let lines = parts.length > 0 ? [...text.lines, ...parts.map(collapseCr)] : text.lines;
  let dropped = text.dropped;
  if (lines.length > max) {
    dropped += lines.length - max;
    lines = lines.slice(lines.length - max);
  }
  return { lines, partial, dropped };
}

/** The lines to draw: the complete ones, then the unfinished one if any. */
export function displayLines(text: LogText): string[] {
  const tail = collapseCr(text.partial);
  return text.partial === "" ? text.lines : [...text.lines, tail];
}

/** Whether there is anything to show. */
export function isEmptyText(text: LogText): boolean {
  return text.lines.length === 0 && text.partial === "";
}

/** A failure card's excerpt opens by itself up to this many lines and
 *  characters; a longer one waits behind "Show log excerpt". */
export const SHORT_EXCERPT_LINES = 8;
export const SHORT_EXCERPT_CHARS = 600;

/** Whether an excerpt is short enough to show without being asked: the first
 *  thing a reader of a failed job wants is the reason, and a few lines do not
 *  push the page. A trailing newline is not a line. */
export function isShortExcerpt(excerpt: string): boolean {
  const trimmed = excerpt.replace(/\n+$/, "");
  return trimmed.length <= SHORT_EXCERPT_CHARS && trimmed.split("\n").length <= SHORT_EXCERPT_LINES;
}
