/**
 * A simulation run by more than one job (ADR 0037): which job is meant, how
 * many there are, and the words for them. Pure, so the arithmetic is tested.
 * What the backend sends is `JobRunFields` (lib/jobs/types.ts); an answer from
 * before the fields existed has none of them, and reads as one job.
 */
import type { Continuation, JobRunFields, PreviousJob } from "@/lib/jobs/types";
import { secondsBetween } from "@/lib/workspace/timeline";

/** The part of a job or a status answer these functions read. */
export type JobRuns = Partial<Pick<JobRunFields, "previous_jobs" | "job_number" | "max_jobs" | "continuation">>;

/** The job running now, or the one that ran last (1-based). */
export function currentJobNumber(runs: JobRuns): number {
  return runs.job_number ?? (runs.previous_jobs?.length ?? 0) + 1;
}

/** How many jobs the simulation has had so far, the one being submitted
 *  included. 1 for a simulation run by one job. */
export function jobCount(runs: JobRuns): number {
  return Math.max(currentJobNumber(runs), (runs.previous_jobs?.length ?? 0) + 1, runs.continuation?.number ?? 1);
}

/** "Job 2": which job this is; null for a simulation that has had only one.
 *  The job being submitted counts as the one meant. How many jobs a simulation
 *  may use is not said: a person is told its limit as time (2 weeks). */
export function describeJobNumber(runs: JobRuns): string | null {
  if (jobCount(runs) < 2) return null;
  return `Job ${runs.continuation?.number ?? currentJobNumber(runs)}`;
}

/** The sentence that goes with `describeJobNumber`: why there is more than one
 *  job. Null when there is only one. */
export function describeContinuation(runs: JobRuns): string | null {
  if (jobCount(runs) < 2) return null;
  return "Continued after the previous job reached its time limit, from the state WBM had saved.";
}

/** The words for a submit of the next job that has not gone through yet:
 *  after how many earlier attempts. */
export function describeContinuationTries(continuation: Continuation): string | null {
  const { tries } = continuation;
  if (tries < 1) return null;
  return `${tries} earlier ${tries === 1 ? "attempt" : "attempts"} did not go through; the gateway tries again.`;
}

/** Seconds a job ran, from SLURM's own start and end; null when either is missing. */
export function jobRanSeconds(job: Pick<PreviousJob, "slurm_start" | "slurm_end">): number | null {
  return secondsBetween(job.slurm_start, job.slurm_end);
}

/** The time the jobs that already ended ran, in all; null when none of them has
 *  a start and an end. */
export function previousRanSeconds(previous: readonly PreviousJob[] | undefined): number | null {
  let total: number | null = null;
  for (const job of previous ?? []) {
    const ran = jobRanSeconds(job);
    if (ran !== null) total = (total ?? 0) + ran;
  }
  return total;
}

/** When the job running now (or that ran last) began to wait for SLURM: the end
 *  of the job before it, which the gateway continues at once, and else the
 *  simulation's own submit. Without this a continued job would "wait" for
 *  the whole of the jobs before it. */
export function waitingSince(
  previous: readonly PreviousJob[] | undefined,
  submittedAt: string | null
): string | null {
  const last = previous && previous.length > 0 ? previous[previous.length - 1].slurm_end : null;
  return last ?? submittedAt;
}
