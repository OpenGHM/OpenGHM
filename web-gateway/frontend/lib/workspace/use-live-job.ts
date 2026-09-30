"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { pollJobStatus } from "@/lib/jobs/actions";
import type { JobLive, JobStatus, JobStatusResponse } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";
import {
  POLL_INTERVAL_MS,
  describePollError,
  mergeView,
  nextPollDelay,
  toView,
  visibilityAction,
  type StatusView,
} from "@/lib/workspace/live-poll";

export type { StatusView } from "@/lib/workspace/live-poll";

export interface UseLiveJobResult {
  jobId: string;
  /** The latest status response. */
  view: StatusView;
  status: JobStatus;
  slurmJobId: string | null;
  submittedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  statusReason: string | null;
  /** What SLURM said at `live.checked_at`; null until it has answered, and once
   *  the job has ended. */
  live: JobLive | null;
  /** A cancel was asked for and the status is still not final: SLURM has not
   *  confirmed it yet. Polling continues until it does. */
  cancelling: boolean;
  /** The poll loop is running: the job is not over and nothing has stopped it. */
  polling: boolean;
  /** The browser's clock (ms) when the last good answer arrived; null before
   *  the first one. */
  lastSuccessAt: number | null;
  /** The last poll failed transiently ("Couldn't reach Anvil"); null otherwise. */
  lastError: string | null;
  /** Seconds until the next attempt while `lastError` is set. */
  retryInSeconds: number | null;
  /** The backend answered 401: polling has stopped. Show SessionExpiredBanner.
   *  Cleared if a manual `refresh()` succeeds. */
  sessionExpired: boolean;
  /** Ask now, without waiting for the timer. */
  refresh: () => void;
  /** Take a status response that came from somewhere else (the cancel route
   *  answers with one) and resume polling if the job has not ended. */
  apply: (data: JobStatusResponse) => void;
}

/**
 * Follows a job (ADR 0027): asks for its status every 5 s while it is queued,
 * running or cancelling, and not at all while the tab is hidden. After a failed
 * poll it backs off (5, 10, 20, 40, then 60 s) and resets on the next good
 * answer. A 401 or a 404 stops it, as does a terminal status. Every change of
 * status asks Next for the page again, because the verdict cards beside the
 * panel are chosen on the server from the status it rendered with.
 *
 * Use it once per page, through `LiveJobProvider`: a second instance would be
 * a second poll loop.
 */
export function useLiveJob(
  jobId: string,
  initialStatus: JobStatus,
  initialData?: Partial<JobStatusResponse>,
  options?: { disabled?: boolean }
): UseLiveJobResult {
  const disabled = options?.disabled ?? false;
  const router = useRouter();

  const [view, setView] = useState<StatusView>(() => toView(initialStatus, initialData));
  const [polling, setPolling] = useState(!disabled && !isTerminalStatus(initialStatus));
  const [sessionExpired, setSessionExpired] = useState(false);
  const [lastSuccessAt, setLastSuccessAt] = useState<number | null>(null);
  const [failure, setFailure] = useState<{ message: string; retryAt: number } | null>(null);
  // The clock for the retry countdown; only ticks while a failure is showing.
  const [now, setNow] = useState(0);

  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const failuresRef = useRef(0);
  const stoppedRef = useRef(disabled || isTerminalStatus(initialStatus));
  // The status the page was last rendered with (by the server, or by the
  // refresh this hook asked for): a different one means ask for the page again.
  const renderedStatusRef = useRef(initialStatus);
  // The latest `poll`, so a timer can call it without naming itself.
  const pollRef = useRef<() => Promise<void>>(async () => {});

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const schedule = useCallback(
    (ms: number) => {
      clearTimer();
      timerRef.current = setTimeout(() => void pollRef.current(), ms);
    },
    [clearTimer]
  );

  /** Take an answer: show it, and decide whether to keep polling. */
  const commit = useCallback(
    (data: JobStatusResponse, { keepLive = false } = {}) => {
      // A poll's `live` (even null) is SLURM's latest word. An answer from
      // elsewhere (the cancel route's) has no say about it: its null is only a
      // default, so the held one stays until the next poll.
      setView((previous) => mergeView(previous, keepLive ? { ...data, live: undefined } : data));
      setSessionExpired(false);
      setFailure(null);
      setLastSuccessAt(Date.now());
      failuresRef.current = 0;

      if (data.status !== renderedStatusRef.current) {
        renderedStatusRef.current = data.status;
        router.refresh();
      }

      if (isTerminalStatus(data.status)) {
        stoppedRef.current = true;
        clearTimer();
        setPolling(false);
      } else if (!disabled) {
        stoppedRef.current = false;
        setPolling(true);
        schedule(POLL_INTERVAL_MS);
      }
    },
    [router, disabled, clearTimer, schedule]
  );

  const fail = useCallback(
    (message: string) => {
      failuresRef.current += 1;
      const delay = nextPollDelay(failuresRef.current);
      const at = Date.now();
      setNow(at);
      setFailure({ message, retryAt: at + delay });
      schedule(delay);
    },
    [schedule]
  );

  const poll = useCallback(async () => {
    if (disabled || stoppedRef.current || inFlightRef.current) return;
    // Nothing to watch in a hidden tab; showing it again polls at once.
    if (document.visibilityState === "hidden") return;

    inFlightRef.current = true;
    let result: Awaited<ReturnType<typeof pollJobStatus>> | null = null;
    try {
      result = await pollJobStatus(jobId);
    } catch {
      // The action itself could not run: the network, or a deploy in progress.
    } finally {
      inFlightRef.current = false;
    }
    if (!mountedRef.current) return;

    if (result === null) return fail(describePollError({ thrown: true }));
    if (result.ok) return commit(result.data);

    if (result.reason === "session_expired") {
      // Retrying a 401 cannot succeed until the user signs in again.
      stoppedRef.current = true;
      setSessionExpired(true);
      setFailure(null);
      setPolling(false);
    } else if (result.reason === "not_found") {
      // Deleted, or never ours: nothing left to watch.
      stoppedRef.current = true;
      setFailure(null);
      setPolling(false);
    } else {
      fail(describePollError({ status: result.status }));
    }
  }, [jobId, disabled, commit, fail]);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  // Poll once on mount: the page's own data has no `live`, and the first
  // answer is what the freshness line and the queue reason wait for.
  useEffect(() => {
    mountedRef.current = true;
    if (!stoppedRef.current) void pollRef.current();
    return () => {
      mountedRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  useEffect(() => {
    if (disabled) return;
    const onVisibility = () => {
      const action = visibilityAction(document.visibilityState === "visible", stoppedRef.current);
      if (action === "pause") clearTimer();
      else if (action === "poll") {
        clearTimer();
        void pollRef.current();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [disabled, clearTimer]);

  // The retry countdown.
  const retryAt = failure?.retryAt ?? null;
  useEffect(() => {
    if (retryAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [retryAt]);

  const refresh = useCallback(() => {
    if (disabled) return;
    clearTimer();
    void pollRef.current();
  }, [disabled, clearTimer]);

  const apply = useCallback(
    (data: JobStatusResponse) => {
      if (!mountedRef.current) return;
      commit(data, { keepLive: true });
    },
    [commit]
  );

  return {
    jobId,
    view,
    status: view.status,
    slurmJobId: view.slurm_job_id,
    submittedAt: view.submitted_at,
    startedAt: view.started_at,
    completedAt: view.completed_at,
    statusReason: view.status_reason,
    live: view.live,
    cancelling: view.cancel_requested_at !== null && !isTerminalStatus(view.status),
    polling,
    lastSuccessAt,
    lastError: failure?.message ?? null,
    retryInSeconds: failure ? Math.max(0, Math.ceil((failure.retryAt - now) / 1000)) : null,
    sessionExpired,
    refresh,
    apply,
  };
}
