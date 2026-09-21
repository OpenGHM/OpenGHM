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
  /** Force an immediate refresh. */
  refresh: () => void;
}

/**
 * Custom hook that polls GET /jobs/{id}/status at an adaptive interval.
 * Automatically stops when the job reaches a terminal state.
 */
export function useJobStatus(
  jobId: string,
  initialStatus: JobStatus,
  initialData?: Partial<JobStatusResponse>
): UseJobStatusResult {
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
  const [isPolling, setIsPolling] = useState(!isTerminalStatus(initialStatus));

  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doFetch = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const data = await pollJobStatus(jobId);
      if (!mountedRef.current) return;

      setStatus(data.status);
      setSlurmJobId(data.slurm_job_id);
      setSubmittedAt(data.submitted_at);
      setStartedAt(data.started_at);
      setCompletedAt(data.completed_at);
      setStatusReason(data.status_reason);

      if (isTerminalStatus(data.status)) {
        setIsPolling(false);
      } else {
        // Schedule next poll
        timerRef.current = setTimeout(doFetch, intervalFor(data.status));
      }
    } catch {
      if (!mountedRef.current) return;
      // Retry after a delay on error
      timerRef.current = setTimeout(doFetch, SLOW_INTERVAL);
    }
  }, [jobId]);

  // Start polling on mount
  useEffect(() => {
    mountedRef.current = true;

    if (!isTerminalStatus(initialStatus)) {
      timerRef.current = setTimeout(doFetch, intervalFor(initialStatus));
    }

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [doFetch, initialStatus]);

  const refresh = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    doFetch();
  }, [doFetch]);

  return {
    status,
    slurmJobId,
    submittedAt,
    startedAt,
    completedAt,
    statusReason,
    isPolling,
    refresh,
  };
}
