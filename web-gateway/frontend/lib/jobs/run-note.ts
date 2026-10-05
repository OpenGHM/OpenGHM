/**
 * The one thing a snapshot draft's list row says about its simulation besides the title of
 * the snapshot it is based on: the period it ran, when that is news.
 *
 * Pure: no I/O. `lib/jobs/run-notes.ts` reads the snapshots for a page of rows.
 */
import type { Dataset } from "@/lib/repository/types";
import type { Job } from "@/lib/jobs/types";

const YEAR_START = /^(\d{4})-01-01$/;
const YEAR_END = /^(\d{4})-12-31$/;

/**
 * The period a simulation covers, from its two dates: "2000–2001" when it runs from a
 * January 1 to a December 31 (the usual simulation), otherwise the dates themselves,
 * "2000-03-01 → 2000-12-31", so a partial year is never rounded to a whole
 * one. Null while either date is not set (a draft that has not got that far).
 */
export function runPeriodLabel(start: string | null | undefined, end: string | null | undefined): string | null {
  if (!start || !end) return null;
  const from = YEAR_START.exec(start)?.[1];
  const to = YEAR_END.exec(end)?.[1];
  if (from && to) return from === to ? from : `${from}–${to}`;
  return `${start} → ${end}`;
}

/**
 * "Run 2000–2005" when the snapshot draft runs a shorter period than its snapshot
 * covers, else null: a simulation of the whole period has nothing to add to the
 * snapshot's title. With no snapshot to compare against (it left the repository
 * or could not be read) the period is said, since nothing says it is the whole.
 * Null too while the dates are not set.
 */
export function runNote(job: Job, snapshot: Dataset | null): string | null {
  const start = job.parameters?.temporal_range_start;
  const end = job.parameters?.temporal_range_end;
  const run = runPeriodLabel(start, end);
  if (!run) return null;
  const coverage = snapshot?.simulation.temporalCoverage;
  if (coverage !== undefined && coverage.start === start && coverage.end === end) return null;
  return `Run ${run}`;
}
