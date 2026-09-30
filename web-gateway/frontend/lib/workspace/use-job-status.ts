"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pollJobStatus } from "@/lib/jobs/actions";
import type { JobStatus, JobStatusResponse } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";

/** Polling intervals in ms, keyed by status group. */
const FAST_INTERVAL = 5_000; // PENDING / SUBMITTED
const SLOW_INTERVAL = 10_000; // RUNNING / COMPLETING

function intervalFor(status: JobStatus): number {
  if (status === "RUNNING" || status === "COMPLETING") return SLOW_INTERVAL;
  return FAST_INTERVAL;
}

export interface UseJobStatusResult {
  status: JobStatus;
  slurmJobId: number | null;
  submittedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  statusReason: string | null;
  isPolling: boolean;
  /** The backend answered 401: polling has stopped. Show SessionExpiredBanner.
   *  Cleared if a manual `refresh()` succeeds. */
  sessionExpired: boolean;
  /** Force an immediate refresh. */
  refresh: () => void;
}

/**
 * Custom hook that polls GET /jobs/{id}/status at an adaptive interval.
 * Automatically stops when the job reaches a terminal state, when the
 * session has expired (401), or when the job is gone (404).
 */
export function useJobStatus(
  jobId: string,
  initialStatus: JobStatus,
  initialData?: Partial<JobStatusResponse>,
  options?: { disabled?: boolean }
): UseJobStatusResult {
  const disabled = options?.disabled ?? false;
  const [status, setStatus] = useState<JobStatus>(initialStatus);
  const [slurmJobId, setSlurmJobId] = useState<number | null>(
    initialData?.slurm_job_id ?? null
  );
  const [submittedAt, setSubmittedAt] = useState<string | null>(
    initialData?.submitted_at ?? null
  );
  const [startedAt, setStartedAt] = useState<string | null>(
    initialData?.started_at ?? null
  );
  const [completedAt, setCompletedAt] = useState<string | null>(
    initialData?.completed_at ?? null
  );
  const [statusReason, setStatusReason] = useState<string | null>(
    initialData?.status_reason ?? null
  );
  const [isPolling, setIsPolling] = useState(!disabled && !isTerminalStatus(initialStatus));

  const [sessionExpired, setSessionExpired] = useState(false);

  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doFetch = useCallback(async () => {
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
          timerRef.current = setTimeout(doFetch, SLOW_INTERVAL);
        }
        return;
      }

      const data = result.data;
      setSessionExpired(false);
      setStatus(data.status);
      setSlurmJobId(data.slurm_job_id);
      setSubmittedAt(data.submitted_at);
      setStartedAt(data.started_at);
      setCompletedAt(data.completed_at);
      setStatusReason(data.status_reason);

      if (isTerminalStatus(data.status)) {
        setIsPolling(false);
      } else {
        setIsPolling(true);
        // Schedule next poll
        timerRef.current = setTimeout(doFetch, intervalFor(data.status));
      }
    } catch {
      if (!mountedRef.current) return;
      // Network-level failure (the action itself could not run) — retry after a delay
      timerRef.current = setTimeout(doFetch, SLOW_INTERVAL);
    }
  }, [jobId, disabled]);

  // Start polling on mount
  useEffect(() => {
    mountedRef.current = true;

    if (!disabled && !isTerminalStatus(initialStatus)) {
      timerRef.current = setTimeout(doFetch, intervalFor(initialStatus));
    }

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [doFetch, initialStatus, disabled]);

  const refresh = useCallback(() => {
    if (disabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    doFetch();
  }, [doFetch, disabled]);

  return {
    status,
    slurmJobId,
    submittedAt,
    startedAt,
    completedAt,
    statusReason,
    isPolling,
    sessionExpired,
    refresh,
  };
}
