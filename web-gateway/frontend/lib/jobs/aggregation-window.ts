/**
 * What a snapshot's multi-year aggregation asks of the run dates, for the Start
 * and End fields.
 *
 * With `TA_multi_year_start` and `TA_multi_year_timestep` set in its init, WBM
 * stops at start-up unless that year lies inside the run: the run must start in
 * or before the year and end on or after its December 31. The backend reads the
 * year from the init once and sends it as `Dataset.aggregationStartYear`
 * (`DatasetDetailResponse` in app/models/repository.py); `check_run_dates` in
 * app/services/run_start.py applies the same rule on submit and words it the
 * same way (`aggregation_messages`). This file mirrors both so a field can say
 * it while the person types.
 */
import { isRealDate } from "@/lib/jobs/run-start";
import type { Dataset } from "@/lib/repository/types";

export interface AggregationProblems {
  /** Why the start is too late, or null. */
  start: string | null;
  /** Why the end is too early, or null. */
  end: string | null;
}

const NONE: AggregationProblems = { start: null, end: null };

/** The sentence for each date; the same words as `aggregation_messages` in the backend. */
export function aggregationMessages(
  year: number,
  snapshotStart?: string,
  snapshotEnd?: string
): { start: string; end: string } {
  const edge = `${String(year).padStart(4, "0")}-12-31`;
  const lead = `This snapshot's model also aggregates its results over multi-year periods that begin in ${year}, so`;
  const startRange = snapshotStart && snapshotStart <= edge ? ` (allowed: ${snapshotStart} to ${edge})` : "";
  const endRange = snapshotEnd && edge <= snapshotEnd ? ` (allowed: ${edge} to ${snapshotEnd})` : "";
  return {
    start: `${lead} a run can start no later than ${edge}${startRange}.`,
    end: `${lead} a run must end on or after ${edge}${endRange}.`,
  };
}

/**
 * Which of the two dates break the window; nothing when `year` is null (no
 * window, or the init could not be read). A date equal to the snapshot's own is
 * the published run's and passes; a value that is not a real date is the date
 * field's to refuse. December 30 passes: a 360-day calendar's last day, which
 * the init does not announce, so WBM decides.
 */
export function checkAggregationWindow(
  year: number | null | undefined,
  start: string,
  end: string,
  snapshotStart?: string,
  snapshotEnd?: string
): AggregationProblems {
  if (year === null || year === undefined) return NONE;
  const messages = aggregationMessages(year, snapshotStart, snapshotEnd);
  const lastDecember = `${String(year).padStart(4, "0")}-12-30`;
  return {
    start:
      isRealDate(start) && start !== snapshotStart && Number(start.slice(0, 4)) > year
        ? messages.start
        : null,
    end: isRealDate(end) && end !== snapshotEnd && end < lastDecember ? messages.end : null,
  };
}

/** `checkAggregationWindow` against a snapshot, with its coverage as the range. */
export function checkAggregationWindowFor(
  snapshot: Dataset | null,
  start: string,
  end: string
): AggregationProblems {
  if (!snapshot) return NONE;
  const { start: lo, end: hi } = snapshot.simulation.temporalCoverage;
  return checkAggregationWindow(snapshot.aggregationStartYear, start, end, lo, hi);
}
