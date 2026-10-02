"use client";

import { createContext, useContext } from "react";
import type { JobStatus, JobStatusResponse } from "@/lib/jobs/types";
import { useLiveJob, type UseLiveJobResult } from "@/lib/workspace/use-live-job";

const LiveJobContext = createContext<UseLiveJobResult | null>(null);

/**
 * Holds the one `useLiveJob` of a job page, so that the header, the status summary
 * and the log viewer read the same answer and share one poll
 * loop (ADR 0027). Put it around the cards once; it must not be remounted when
 * the status changes, or the loop restarts.
 */
export function LiveJobProvider({
  jobId,
  initialStatus,
  initialData,
  preview = false,
  children,
}: {
  jobId: string;
  initialStatus: JobStatus;
  initialData?: Partial<JobStatusResponse>;
  /** Fixture data: nothing is polled, and `initialData` (including its `live`)
   *  is what every card shows. */
  preview?: boolean;
  children: React.ReactNode;
}) {
  const live = useLiveJob(jobId, initialStatus, initialData, { disabled: preview });
  return <LiveJobContext.Provider value={live}>{children}</LiveJobContext.Provider>;
}

/** The job this page follows. Only inside `LiveJobProvider`. */
export function useLiveJobContext(): UseLiveJobResult {
  const value = useContext(LiveJobContext);
  if (!value) throw new Error("useLiveJobContext must be used inside LiveJobProvider");
  return value;
}
