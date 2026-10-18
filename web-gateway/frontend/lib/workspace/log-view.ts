/**
 * What the Logs box says where a log has nothing to show. The words are pure
 * so they are tested.
 */
import type { FailureCause, JobStatus } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";

/** Causes where SLURM ended the job from outside, so it never wrote to stderr. */
const SLURM_STOPPED: ReadonlySet<FailureCause> = new Set(["out_of_memory", "timeout"]);

/** Whether the job is at a point where its logs can exist. */
export function logsReadable(status: JobStatus): boolean {
  return status !== "DRAFT" && status !== "PENDING" && status !== "SUBMITTED";
}

/**
 * The line to put under Messages when stderr is empty and SLURM stopped the job from outside (out of memory, time limit):
 * an empty Messages is then no sign that nothing went wrong. `null` for any
 * other job.
 */
export function stoppedMessage(input: {
  status: JobStatus;
  failure: { cause: FailureCause; excerpt: string | null } | null;
  /** WBM's log has something in it, or has not been read yet. False only when
   *  it is known to be missing or empty. */
  wbmLog: boolean;
}): string | null {
  const { status, failure, wbmLog } = input;
  if (!isTerminalStatus(status) || !failure || !SLURM_STOPPED.has(failure.cause)) return null;
  const seeExcerpt = failure.excerpt ? " (see the log excerpt in the failure card)" : "";
  const progress = wbmLog ? "; the WBM log shows how far it got" : "";
  return `Nothing was written to stderr. SLURM stopped this simulation${seeExcerpt}${progress}.`;
}
