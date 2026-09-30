"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { fetchJobLog } from "@/lib/jobs/actions";
import type { JobLogChunk, JobStatus, LogStream } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";
import { nextPollDelay } from "@/lib/workspace/live-poll";
import { logsReadable } from "@/lib/workspace/log-view";
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

/**
 * Reads the active log stream of a job (ADR 0027). Only that stream is read;
 * another loads the first time it is selected. The first read is a tail; then
 * it appends from `next_offset`, at once while there is more, every 5 s once
 * caught up. It reads only while the job is not over and the tab is visible;
 * when the job ends it reads to the end of the file once more and stops. Not
 * before the job has started: there is nothing on Anvil to read.
 */
export function useJobLogs({
  jobId,
  stream,
  status,
  disabled,
}: {
  jobId: string;
  stream: LogStream;
  status: JobStatus;
  /** Fixture data: never read. */
  disabled: boolean;
}): {
  states: LogStates;
  sessionExpired: boolean;
  /** Read again now, after a failure. */
  retry: () => void;
} {
  const [states, dispatch] = useReducer(reducer, INITIAL_STATES);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const offsetsRef = useRef<Record<LogStream, number | null>>({ wbm: null, stdout: null, stderr: null });
  const inFlightRef = useRef<Partial<Record<LogStream, Promise<ReadOutcome>>>>({});
  const terminalRef = useRef(isTerminalStatus(status));
  const wakeRef = useRef<(() => void) | null>(null);

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

    let stopped = false;
    let finished = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const schedule = (ms: number) => {
      clear();
      timer = setTimeout(() => void step(), ms);
    };

    const step = async () => {
      timer = null;
      if (stopped || finished) return;
      // A hidden tab reads nothing; showing it again resumes.
      if (document.visibilityState === "hidden") return;

      const endedBeforeRead = terminalRef.current;
      const outcome = await read(stream);
      if (stopped) return;

      if (outcome === "stop") {
        finished = true;
        return;
      }
      if (outcome === "error") {
        failures += 1;
        // An ended job has nothing more coming; Retry is the person's call.
        if (!terminalRef.current) schedule(nextPollDelay(failures));
        return;
      }
      failures = 0;
      if (outcome === "more") return schedule(0);
      // Caught up. Done only if the job had ended before this read began: a
      // read that raced the ending may have missed the last bytes.
      if (endedBeforeRead) {
        finished = true;
      } else if (terminalRef.current) {
        schedule(0);
      } else {
        schedule(LOG_POLL_MS);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") clear();
      else if (!finished) {
        clear();
        void step();
      }
    };
    wakeRef.current = () => {
      if (!finished) {
        clear();
        void step();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    void step();

    return () => {
      stopped = true;
      clear();
      wakeRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [disabled, readable, stream, read, retryTick]);

  // The job ended: read what is left, once.
  useEffect(() => {
    if (terminal) wakeRef.current?.();
  }, [terminal]);

  const retry = useCallback(() => setRetryTick((n) => n + 1), []);

  return { states, sessionExpired, retry };
}
