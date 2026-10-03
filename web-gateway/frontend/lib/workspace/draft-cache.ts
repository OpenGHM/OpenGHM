/**
 * The latest saved copy of each draft this tab has seen.
 *
 * Next restores a page from its back/forward cache with the props it was
 * rendered with, which can predate what an explicit save has written since. The
 * wizard therefore starts from whichever is newer by `updated_at`: the job the
 * server page rendered, or what this module last saw saved. Module state, so it
 * lives as long as the tab and is gone on a full reload, which is right: a
 * reload renders fresh from the server.
 */
import type { Job } from "@/lib/jobs/types";

const cache = new Map<string, Job>();

/** Milliseconds, or null for a job that has no usable `updated_at`. */
function stamp(job: Job): number | null {
  if (!job.updated_at) return null;
  const ms = Date.parse(job.updated_at);
  return Number.isNaN(ms) ? null : ms;
}

/** True when `candidate` was written strictly after `current`. A job with no
 *  timestamp is older than any that has one, and two without are not ordered. */
function isNewer(candidate: Job, current: Job): boolean {
  const a = stamp(candidate);
  const b = stamp(current);
  if (a === null) return false;
  if (b === null) return true;
  return a > b;
}

export function readDraftCache(id: string): Job | undefined {
  return cache.get(id);
}

/** Remember `job` unless the cache already holds a newer copy of it. */
export function writeDraftCache(job: Job): void {
  const held = cache.get(job.id);
  if (!held || !isNewer(held, job)) cache.set(job.id, job);
}

/** Whichever of the server's job and the cached one is newer; the server's on
 *  a tie, since it is the source of truth. */
export function newerJob(serverJob: Job): Job {
  const held = cache.get(serverJob.id);
  return held && isNewer(held, serverJob) ? held : serverJob;
}

/** Forget one draft, or all of them (tests). */
export function clearDraftCache(id?: string): void {
  if (id === undefined) cache.clear();
  else cache.delete(id);
}
