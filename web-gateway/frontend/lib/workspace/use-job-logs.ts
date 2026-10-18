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

type LogStates = Record<LogStream, StreamState>;

const INITIAL_STATES: LogStates = {
  wbm: INITIAL_STREAM,
  stdout: INITIAL_STREAM,
  stderr: INITIAL_STREAM,
};

type Action =
  | { type: "chunk"; stream: LogStream; chunk: JobLogChunk }
  | { type: "error"; stream: LogStream; message: string }
  /** The job shown changed: what was read of its streams is not theirs. */
  | { type: "reset"; streams: readonly LogStream[] };

/** The streams a job of its own has files for; `wbm` is one file across jobs. */
const PER_JOB: readonly LogStream[] = ["stdout", "stderr"];

function reducer(states: LogStates, action: Action): LogStates {
  if (action.type === "reset") {
    return { ...states, ...Object.fromEntries(action.streams.map((s) => [s, INITIAL_STREAM])) };
  }
  const current = states[action.stream];
  return {
    ...states,
    [action.stream]:
      action.type === "chunk"
        ? applyChunk(current, action.chunk)
        : { ...current, loaded: true, error: action.message },
  };
}

/** The streams are read in this order, one after another: the model's own log
 *  first, since that is what a running job is waited on for. */
const READ_ORDER: readonly LogStream[] = ["wbm", "stdout", "stderr"];

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
 * Reads the three logs of a job (ADR 0027), one after another, never at once,
 * so the request rate does not grow with the number of files. The first read
 * of a stream is a tail; then it appends from `next_offset`, at once while
 * there is more, every 5 s once caught up. It reads only while the job is not
 * over and the tab is visible; when the job ends it reads each stream to the
 * end of its file once more and stops. Not before the job has started: there
 * is nothing on Anvil to read, unless an earlier job of the simulation ran
 * (`earlierJobs`).
 *
 * A simulation run by several jobs (ADR 0037) has a stdout and a stderr for
 * each; `job` is the number of the one to read (the backend's current job when
 * it is undefined), and `jobEnded` says that job is over, so its two files stop
 * being read once caught up. WBM's own log is one file across jobs and is read
 * as ever. Changing `job` forgets what was read of stdout and stderr.
 */
export function useJobLogs({
  jobId,
  status,
  disabled,
  job,
  jobEnded = false,
  earlierJobs = false,
}: {
  jobId: string;
  status: JobStatus;
  /** Fixture data: never read. */
  disabled: boolean;
  /** Which job's stdout and stderr to read; undefined is the current job's. */
  job?: number;
  /** The job `job` names has ended, so its stdout and stderr will not grow. */
  jobEnded?: boolean;
  /** An earlier job of the simulation ran, so there are logs to read even
   *  while the next one is being submitted. */
  earlierJobs?: boolean;
}): {
  states: LogStates;
  sessionExpired: boolean;
  /** Read again now, after a failure: one stream, or all. */
  retry: (stream?: LogStream) => void;
} {
  const [states, dispatch] = useReducer(reducer, INITIAL_STATES);
  const [sessionExpired, setSessionExpired] = useState(false);

  const offsetsRef = useRef<Record<LogStream, number | null>>({ wbm: null, stdout: null, stderr: null });
  const inFlightRef = useRef<Partial<Record<LogStream, { job: number | undefined; promise: Promise<ReadOutcome> }>>>({});
  // Bumped when `job` changes, so a read that was under way for the old one is dropped.
  const generationRef = useRef(0);
  const jobRef = useRef(job);
  const jobEndedRef = useRef(jobEnded);
  const terminalRef = useRef(isTerminalStatus(status));
  const wakeRef = useRef<(() => void) | null>(null);
  const retryRef = useRef<((stream?: LogStream) => void) | null>(null);

  const terminal = isTerminalStatus(status);
  const readable = logsReadable(status) || earlierJobs;

  const read = useCallback(
    (which: LogStream): Promise<ReadOutcome> => {
      // The job a stream belongs to: WBM's log has none of its own.
      const forJob = PER_JOB.includes(which) ? job : undefined;
      // One read per stream at a time: a second caller waits for the first
      // rather than reading the same offset twice.
      const running = inFlightRef.current[which];
      if (running && running.job === forJob) return running.promise;

      const generation = generationRef.current;
      const run = async (): Promise<ReadOutcome> => {
        const previous = offsetsRef.current[which];
        let result;
        try {
          result =
            forJob === undefined
              ? await fetchJobLog(jobId, which, previous ?? undefined)
              : await fetchJobLog(jobId, which, previous ?? undefined, undefined, forJob);
        } catch {
          if (generation !== generationRef.current) return "idle";
          dispatch({ type: "error", stream: which, message: "Couldn't reach the gateway." });
          return "error";
        }
        // Read for a job that is no longer the one shown: not this state's.
        if (generation !== generationRef.current && PER_JOB.includes(which)) return "idle";
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
                ? "This simulation no longer exists."
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
        if (inFlightRef.current[which]?.promise === promise) delete inFlightRef.current[which];
      });
      inFlightRef.current[which] = { job: forJob, promise };
      return promise;
    },
    [jobId, job]
  );

  useEffect(() => {
    terminalRef.current = terminal;
  }, [terminal]);

  useEffect(() => {
    jobEndedRef.current = jobEnded;
  }, [jobEnded]);

  // Another job's stdout and stderr: nothing read of the last one is theirs,
  // and they are read from a tail again. This runs before the reader below
  // restarts for the new `read`.
  useEffect(() => {
    if (jobRef.current === job) return;
    jobRef.current = job;
    generationRef.current += 1;
    for (const stream of PER_JOB) offsetsRef.current[stream] = null;
    dispatch({ type: "reset", streams: PER_JOB });
  }, [job]);

  useEffect(() => {
    if (disabled || !readable) return;

    const active = READ_ORDER;
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
        } else if (endedBeforeRead || (jobEndedRef.current && PER_JOB.includes(which))) {
          // Caught up, and the job had ended before this read began: a read
          // that raced the ending may have missed the last bytes. The same for
          // the files of a job of the simulation that is over, whatever the
          // simulation is doing now.
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
  }, [disabled, readable, read]);

  // The job ended: read what is left, once.
  useEffect(() => {
    if (terminal) wakeRef.current?.();
  }, [terminal]);

  const retry = useCallback((stream?: LogStream) => retryRef.current?.(stream), []);

  return { states, sessionExpired, retry };
}
