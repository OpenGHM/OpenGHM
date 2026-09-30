"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pollJobStatus } from "@/lib/jobs/actions";
import type { JobStatus, JobStatusResponse } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";

/** Polling intervals in ms, keyed by status group. */
const FAST_INTERVAL = 5_000; // PENDING / SUBMITTED, and anything waiting on a cancel
const SLOW_INTERVAL = 10_000; // RUNNING / COMPLETING

function intervalFor(status: JobStatus, cancelling: boolean): number {
  if (cancelling) return FAST_INTERVAL;
  if (status === "RUNNING" || status === "COMPLETING") return SLOW_INTERVAL;
  return FAST_INTERVAL;
}

/** Everything the polling response carries except the ids. */
export type StatusView = Omit<JobStatusResponse, "job_id" | "sim_id">;

/** The fields of a (possibly partial) status response, with nulls for the rest. */
function toView(status: JobStatus, data?: Partial<JobStatusResponse>): StatusView {
  return {
    status,
    slurm_job_id: data?.slurm_job_id ?? null,
    submitted_at: data?.submitted_at ?? null,
    started_at: data?.started_at ?? null,
    completed_at: data?.completed_at ?? null,
    status_reason: data?.status_reason ?? null,
    work_dir: data?.work_dir ?? null,
    slurm_state: data?.slurm_state ?? null,
    slurm_exit_code: data?.slurm_exit_code ?? null,
    slurm_start: data?.slurm_start ?? null,
    slurm_end: data?.slurm_end ?? null,
    failure: data?.failure ?? null,
    cancel_requested_at: data?.cancel_requested_at ?? null,
    cancel_requested_by_email: data?.cancel_requested_by_email ?? null,
    files: data?.files ?? null,
    output: data?.output ?? null,
  };
}

export interface UseJobStatusResult {
  /** The latest status response. */
  view: StatusView;
  status: JobStatus;
  slurmJobId: string | null;
  submittedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  statusReason: string | null;
  /** A cancel was asked for and the status is still not final: SLURM has not
   *  confirmed it yet. Polling continues until it does. */
  cancelling: boolean;
  isPolling: boolean;
  /** The backend answered 401: polling has stopped. Show SessionExpiredBanner.
   *  Cleared if a manual `refresh()` succeeds. */
  sessionExpired: boolean;
  /** Force an immediate refresh. */
  refresh: () => void;
  /** Take a status response that came from somewhere else (the cancel route
   *  answers with one) and resume polling if the job has not ended. */
  apply: (data: JobStatusResponse) => void;
}

/**
 * Custom hook that polls GET /jobs/{id}/status at an adaptive interval.
 * Automatically stops when the job reaches a terminal state, when the
 * session has expired (401), or when the job is gone (404). A job that is
 * cancelling is not terminal, so it keeps being polled — faster — until SLURM
 * confirms.
 */
export function useJobStatus(
  jobId: string,
  initialStatus: JobStatus,
  initialData?: Partial<JobStatusResponse>,
  options?: { disabled?: boolean }
): UseJobStatusResult {
  const disabled = options?.disabled ?? false;
  const [view, setView] = useState<StatusView>(() => toView(initialStatus, initialData));
  const [isPolling, setIsPolling] = useState(!disabled && !isTerminalStatus(initialStatus));
  const [sessionExpired, setSessionExpired] = useState(false);

  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The latest `poll`, so a poll can schedule the next one without naming itself.
  const pollRef = useRef<() => Promise<void>>(async () => {});

  const schedule = useCallback((ms: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void pollRef.current(), ms);
  }, []);

  const poll = useCallback(async () => {
    if (disabled) return;
    if (!mountedRef.current) return;
    try {
      const result = await pollJobStatus(jobId);
      if (!mountedRef.current) return;

      if (!result.ok) {
        if (result.reason === "session_expired") {
          // Retrying a 401 cannot succeed until the user signs in again.
          setSessionExpired(true);
          setIsPolling(false);
        } else if (result.reason === "not_found") {
          // Deleted, or never ours: nothing left to watch.
          setIsPolling(false);
        } else {
          // Transient failure — retry after a delay.
          schedule(SLOW_INTERVAL);
        }
        return;
      }

      const data = toView(result.data.status, result.data);
      setSessionExpired(false);
      setView(data);

      if (isTerminalStatus(data.status)) {
        setIsPolling(false);
      } else {
        setIsPolling(true);
        schedule(intervalFor(data.status, data.cancel_requested_at !== null));
      }
    } catch {
      if (!mountedRef.current) return;
      // Network-level failure (the action itself could not run) — retry after a delay
      schedule(SLOW_INTERVAL);
    }
  }, [jobId, disabled, schedule]);

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  // Start polling on mount
  useEffect(() => {
    mountedRef.current = true;

    if (!disabled && !isTerminalStatus(initialStatus)) {
      schedule(intervalFor(initialStatus, initialData?.cancel_requested_at != null));
    }

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // `initialData` is only the first paint; later answers come from polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, initialStatus, disabled]);

  const refresh = useCallback(() => {
    if (disabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    void poll();
  }, [poll, disabled]);

  const apply = useCallback(
    (data: JobStatusResponse) => {
      if (!mountedRef.current) return;
      const rest = toView(data.status, data);
      setView(rest);
      setSessionExpired(false);
      if (isTerminalStatus(rest.status)) {
        if (timerRef.current) clearTimeout(timerRef.current);
        setIsPolling(false);
      } else if (!disabled) {
        setIsPolling(true);
        schedule(intervalFor(rest.status, rest.cancel_requested_at !== null));
      }
    },
    [disabled, schedule]
  );

  return {
    view,
    status: view.status,
    slurmJobId: view.slurm_job_id,
    submittedAt: view.submitted_at,
    startedAt: view.started_at,
    completedAt: view.completed_at,
    statusReason: view.status_reason,
    cancelling: view.cancel_requested_at !== null && !isTerminalStatus(view.status),
    isPolling,
    sessionExpired,
    refresh,
    apply,
  };
}
