/**
 * The two spans a job's page quotes: how long it waited in the queue and how
 * long it ran. Pure, so the arithmetic is tested.
 */
import { formatDuration } from "@/lib/workspace/time";

/** Whole seconds from `fromIso` to `toIso`; `null` when either is missing or
 *  unreadable, and never negative (SLURM's and the gateway's clocks differ a little). */
export function secondsBetween(fromIso: string | null, toIso: string | null): number | null {
  if (!fromIso || !toIso) return null;
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.max(0, Math.floor((to - from) / 1000));
}

/** A span for a sentence: `42 s` under a minute, then whole minutes (`14 min`,
 *  `1 h 5 min`). A queue wait or a simulation does not need the seconds. */
export function shortDuration(totalSeconds: number): string {
  return totalSeconds < 60
    ? `${Math.max(0, Math.floor(totalSeconds))} s`
    : formatDuration(totalSeconds, { withSeconds: false });
}
