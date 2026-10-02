"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { fetchJobLog } from "@/lib/jobs/actions";
import type { JobLogChunk, JobStatus, LogStream } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";
import { nextPollDelay } from "@/lib/workspace/live-poll";
import { logsReadable, streamsForTab, type LogTab } from "@/lib/workspace/log-view";
import {
  INITIAL_STREAM,
  LOG_POLL_MS,
  applyChunk,
  hasMore,
  type StreamState,
} from "@/lib/workspace/log-stream";

export type LogStates = Record<LogStream, StreamState>;

const INITIAL_STATES: LogStates = {
  wbm: INITIAL_STREAM,
  stdout: INITIAL_STREAM,
  stderr: INITIAL_STREAM,
};

type Action =
  | { type: "chunk"; stream: LogStream; chunk: JobLogChunk }
  | { type: "error"; stream: LogStream; message: string };

function reducer(states: LogStates, action: Action): LogStates {
  const current = states[action.stream];
  return {
    ...states,
    [action.stream]:
      action.type === "chunk"
        ? applyChunk(current, action.chunk)
        : { ...current, loaded: true, error: action.message },
  };
}

type ReadOutcome = "more" | "idle" | "error" | "stop";

/** When a stream is next read, and whether it is finished. */
interface Plan {
  /** `Date.now()` at which to read it again. */
  due: number;
  /** Nothing more to read until `retry`. */
  done: boolean;
  /** Reads that failed in a row. */
  failures: number;
}

/**
 * Reads the logs of a job on show (ADR 0027): the one stream of a source tab,
 * or all three for the All tab. Only the streams on show are read; another
 * loads the first time it is shown. The first read of a stream is a tail; then
 * it appends from `next_offset`, at once while there is more, every 5 s once
 * caught up. Several streams are read one after another, never at once, so the
 * request rate does not grow with the tab. It reads only while the job is not
 * over and the tab is visible; when the job ends it reads each stream to the
 * end of its file once more and stops. Not before the job has started: there
 * is nothing on Anvil to read.
 */
export function useJobLogs({
  jobId,
  tab,
  status,
  disabled,
}: {
  jobId: string;
  /** The tab on show. */
  tab: LogTab;
  status: JobStatus;
  /** Fixture data: never read. */
  disabled: boolean;
}): {
  states: LogStates;
  sessionExpired: boolean;
  /** Read again now, after a failure: one stream, or all on show. */
  retry: (stream?: LogStream) => void;
} {
  const [states, dispatch] = useReducer(reducer, INITIAL_STATES);
  const [sessionExpired, setSessionExpired] = useState(false);
  const streamsKey = streamsForTab(tab).join(",");

  const offsetsRef = useRef<Record<LogStream, number | null>>({ wbm: null, stdout: null, stderr: null });
  const inFlightRef = useRef<Partial<Record<LogStream, Promise<ReadOutcome>>>>({});
  const terminalRef = useRef(isTerminalStatus(status));
  const wakeRef = useRef<(() => void) | null>(null);
  const retryRef = useRef<((stream?: LogStream) => void) | null>(null);

  const terminal = isTerminalStatus(status);
  const readable = logsReadable(status);

  const read = useCallback(
    (which: LogStream): Promise<ReadOutcome> => {
      // One read per stream at a time: a second caller waits for the first
      // rather than reading the same offset twice.
      const running = inFlightRef.current[which];
      if (running) return running;

      const run = async (): Promise<ReadOutcome> => {
        const previous = offsetsRef.current[which];
        let result;
        try {
          result = await fetchJobLog(jobId, which, previous ?? undefined);
        } catch {
          dispatch({ type: "error", stream: which, message: "Couldn't reach the gateway." });
          return "error";
        }
        if (!result.ok) {
          if (result.reason === "session_expired") {
            setSessionExpired(true);
            return "stop";
          }
          dispatch({
            type: "error",
            stream: which,
            message:
              result.reason === "not_found"
                ? "This job no longer exists."
                : result.message || "Couldn't read the log.",
          });
          return result.reason === "not_found" ? "stop" : "error";
        }
        setSessionExpired(false);
        const chunk = result.data;
        offsetsRef.current[which] = chunk.exists ? chunk.next_offset : null;
        dispatch({ type: "chunk", stream: which, chunk });
        return hasMore(chunk, previous) ? "more" : "idle";
      };

      const promise = run().finally(() => {
        delete inFlightRef.current[which];
      });
      inFlightRef.current[which] = promise;
      return promise;
    },
    [jobId]
  );

  useEffect(() => {
    terminalRef.current = terminal;
  }, [terminal]);

  useEffect(() => {
    if (disabled || !readable) return;

    const active = streamsKey.split(",") as LogStream[];
    const plans = new Map<LogStream, Plan>(active.map((s) => [s, { due: 0, done: false, failures: 0 }]));
    let stopped = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    // The next step is for the stream due soonest.
    const schedule = () => {
      clear();
      if (stopped || document.visibilityState === "hidden") return;
      const due = Math.min(...[...plans.values()].filter((p) => !p.done).map((p) => p.due));
      if (due === Infinity) return;
      timer = setTimeout(() => void step(), Math.max(0, due - Date.now()));
    };

    const step = async () => {
      timer = null;
      if (stopped || running) return;
      // A hidden tab reads nothing; showing it again resumes.
      if (document.visibilityState === "hidden") return;

      running = true;
      for (const which of active) {
        const plan = plans.get(which);
        if (!plan || plan.done || plan.due > Date.now()) continue;

        const endedBeforeRead = terminalRef.current;
        const outcome = await read(which);
        if (stopped) return;

        if (outcome === "stop") {
          for (const p of plans.values()) p.done = true;
          break;
        }
        if (outcome === "error") {
          plan.failures += 1;
          // An ended job has nothing more coming; Retry is the person's call.
          if (terminalRef.current) plan.done = true;
          else plan.due = Date.now() + nextPollDelay(plan.failures);
          continue;
        }
        plan.failures = 0;
        if (outcome === "more") {
          plan.due = Date.now();
        } else if (endedBeforeRead) {
          // Caught up, and the job had ended before this read began: a read
          // that raced the ending may have missed the last bytes.
          plan.done = true;
        } else if (terminalRef.current) {
          plan.due = Date.now();
        } else {
          plan.due = Date.now() + LOG_POLL_MS;
        }
      }
      running = false;
      schedule();
    };

    // Read what is not finished, now.
    const wake = () => {
      for (const p of plans.values()) if (!p.done) p.due = 0;
      if (running) return;
      clear();
      void step();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") clear();
      else wake();
    };

    wakeRef.current = wake;
    retryRef.current = (which) => {
      for (const [s, p] of plans) {
        if (which === undefined || which === s) Object.assign(p, { due: 0, done: false, failures: 0 });
      }
      if (running) return;
      clear();
      void step();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void step();

    return () => {
      stopped = true;
      clear();
      wakeRef.current = null;
      retryRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [disabled, readable, streamsKey, read]);

  // The job ended: read what is left, once.
  useEffect(() => {
    if (terminal) wakeRef.current?.();
  }, [terminal]);

  const retry = useCallback((stream?: LogStream) => retryRef.current?.(stream), []);

  return { states, sessionExpired, retry };
}
