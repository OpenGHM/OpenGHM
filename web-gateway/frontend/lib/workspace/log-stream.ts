/**
 * The client's state for one log stream: what has been read, and where to read
 * next (ADR 0027). The first read of a stream is a tail; every later one
 * continues from `next_offset`.
 */
import type { JobLogChunk } from "@/lib/jobs/types";
import { appendText, EMPTY_LOG_TEXT, type LogText } from "@/lib/workspace/log-lines";

/** How long to wait once a stream is caught up. */
export const LOG_POLL_MS = 5_000;

export interface StreamState {
  /** A read has answered at least once. */
  loaded: boolean;
  /** The file is on Anvil. False until it is written, and after a purge. */
  exists: boolean;
  text: LogText;
  /** Where the next read starts; null until the file exists (read a tail). */
  nextOffset: number | null;
  /** File size in bytes at the last read. */
  size: number;
  /** The first chunk began after byte 0: the start of the file is not shown,
   *  and line numbers count from the first line shown. */
  startedMidway: boolean;
  /** The last read failed; the text so far is kept. */
  error: string | null;
}

export const INITIAL_STREAM: StreamState = {
  loaded: false,
  exists: false,
  text: EMPTY_LOG_TEXT,
  nextOffset: null,
  size: 0,
  startedMidway: false,
  error: null,
};

/** The state after a read answered. A read with no offset (`nextOffset` null
 *  before it) is a tail, and starts the text afresh. */
export function applyChunk(state: StreamState, chunk: JobLogChunk): StreamState {
  if (!chunk.exists) {
    // Not there (yet, or purged): forget what was shown, and tail when it appears.
    return { ...INITIAL_STREAM, loaded: true };
  }
  const isTail = state.nextOffset === null;
  const base = isTail ? EMPTY_LOG_TEXT : state.text;
  return {
    loaded: true,
    exists: true,
    text: appendText(base, chunk.data),
    nextOffset: chunk.next_offset,
    size: Math.max(chunk.size, chunk.next_offset),
    startedMidway: isTail ? chunk.offset > 0 : state.startedMidway,
    error: null,
  };
}

/** Whether to read again at once: the answer did not reach the end of the file
 *  and moved on. Otherwise the stream is caught up. */
export function hasMore(chunk: JobLogChunk, previousOffset: number | null): boolean {
  if (!chunk.exists || chunk.eof) return false;
  return chunk.next_offset > (previousOffset ?? chunk.offset);
}

/** A stream showing fixed text (the dev preview): loaded, nothing to read.
 *  `undefined` is a log that was never written. */
export function previewStreamState(text: string | undefined): StreamState {
  if (text === undefined) return { ...INITIAL_STREAM, loaded: true };
  const size = new TextEncoder().encode(text).length;
  return {
    ...INITIAL_STREAM,
    loaded: true,
    exists: true,
    text: appendText(EMPTY_LOG_TEXT, text),
    nextOffset: size,
    size,
  };
}
