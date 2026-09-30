import type { JobStatus } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";

/** What the badge shows. `CANCELLING` is not a stored status: a cancel has
 *  been asked for, and SLURM has not yet confirmed it (ADR 0026). */
export type DisplayStatus = JobStatus | "CANCELLING";

/**
 * The status a person should read. A job whose cancel was requested but whose
 * status is still non-terminal is *Cancelling*; once SLURM confirms, or the
 * job ends some other way first, the real status wins.
 */
export function displayStatus(job: {
  status: JobStatus;
  cancel_requested_at?: string | null;
}): DisplayStatus {
  if (job.cancel_requested_at && !isTerminalStatus(job.status) && job.status !== "DRAFT") {
    return "CANCELLING";
  }
  return job.status;
}
