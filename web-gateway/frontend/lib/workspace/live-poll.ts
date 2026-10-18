/**
 * The pure parts of following a job live (ADR 0027): how long to wait between
 * polls, when to poll at all, what a failed poll is called, and the shape of
 * the answer the screen holds. `use-live-job.ts` wires them to timers.
 */
import type { JobLive, JobRunFields, JobStatus, JobStatusResponse, PublishRecord } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";
import { currentJobNumber } from "@/lib/workspace/job-runs";

/** How often a queued, running or cancelling job is asked about. */
export const POLL_INTERVAL_MS = 5_000;

/**
 * Whether a job is still worth asking about: it has not ended, or it has and
 * its draft is being published. A publish outlives the simulation (the run is
 * COMPLETED while the publish job is on Anvil), so a terminal status alone is
 * not a reason to stop.
 */
export function isFollowed(status: JobStatus, publish: PublishRecord | null | undefined): boolean {
  return !isTerminalStatus(status) || publish?.state === "publishing";
}

/** The wait after the 1st, 2nd, 3rd ... failed poll in a row; the last repeats. */
export const BACKOFF_STEPS_MS = [5_000, 10_000, 20_000, 40_000, 60_000] as const;

/** Wait before the next poll, given how many polls in a row have failed. */
export function nextPollDelay(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return POLL_INTERVAL_MS;
  return BACKOFF_STEPS_MS[Math.min(consecutiveFailures, BACKOFF_STEPS_MS.length) - 1];
}

/** What to do when the tab's visibility changes: stop asking while it is
 *  hidden, ask at once when it is shown again (unless polling has ended). */
export function visibilityAction(visible: boolean, stopped: boolean): "pause" | "poll" | "none" {
  if (!visible) return "pause";
  return stopped ? "none" : "poll";
}

/** The words for a poll that did not get an answer. `status` is the HTTP
 *  status the backend answered with; absent when the call itself failed. */
export function describePollError(
  failure: { thrown: true } | { status?: number; code?: string }
): string {
  if ("thrown" in failure) return "Couldn't reach the gateway";
  // The action ran but its server could not reach the backend.
  if (failure.code === "backend_unreachable") return "Couldn't reach the gateway";
  const status = failure.status;
  if (status === 502 || status === 503 || status === 504) return "Couldn't reach Anvil";
  return "Couldn't check the simulation's status";
}

/** Everything a status response carries except the ids; `live` is always set,
 *  and so are the run fields (one job, none ended, when the answer had none:
 *  `max_jobs` 0 is "not known"). */
export type StatusView = Omit<JobStatusResponse, "job_id" | "sim_id" | "live" | "publish" | keyof JobRunFields> &
  JobRunFields & {
    live: JobLive | null;
    publish: PublishRecord | null;
  };

/** The fields of a (possibly partial) status response, with nulls for the rest. */
export function toView(status: JobStatus, data?: Partial<JobStatusResponse>): StatusView {
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
    publish: data?.publish ?? null,
    live: data?.live ?? null,
    previous_jobs: data?.previous_jobs ?? [],
    job_number: currentJobNumber(data ?? {}),
    max_jobs: data?.max_jobs ?? 0,
    continuation: data?.continuation ?? null,
  };
}

/** The view after a new answer. An answer without a `live` key (the cancel
 *  route's) keeps the one already held; an explicit `null` replaces it. The
 *  same goes for `publish` and for the run fields (`previous_jobs`,
 *  `job_number`, `max_jobs`, `continuation`). */
export function mergeView(previous: StatusView, data: JobStatusResponse): StatusView {
  const next = toView(data.status, data);
  if (data.live === undefined) next.live = previous.live;
  if (data.publish === undefined) next.publish = previous.publish;
  if (data.previous_jobs === undefined) next.previous_jobs = previous.previous_jobs;
  if (data.job_number === undefined) next.job_number = previous.job_number;
  if (data.max_jobs === undefined) next.max_jobs = previous.max_jobs;
  if (data.continuation === undefined) next.continuation = previous.continuation;
  return next;
}
