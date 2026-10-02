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
  /** The same two, short enough to sit under their date field (the sentence
   *  above belongs in a list of problems, and on the 422). */
  startShort: string | null;
  endShort: string | null;
}

const NONE: AggregationProblems = { start: null, end: null, startShort: null, endShort: null };

const edgeOf = (year: number) => `${String(year).padStart(4, "0")}-12-31`;

/** The sentence for each date; the same words as `aggregation_messages` in the
 *  backend. Where the range the coverage leaves is one date, it says "on" that
 *  date instead of "(allowed: X to X)". */
export function aggregationMessages(
  year: number,
  snapshotStart?: string,
  snapshotEnd?: string
): { start: string; end: string } {
  const edge = edgeOf(year);
  const lead = `This snapshot's model also aggregates its results over multi-year periods that begin in ${year}, so`;
  const start =
    snapshotStart && snapshotStart <= edge
      ? snapshotStart === edge
        ? `a run must start on ${edge}`
        : `a run can start no later than ${edge} (allowed: ${snapshotStart} to ${edge})`
      : `a run can start no later than ${edge}`;
  const end =
    snapshotEnd && edge <= snapshotEnd
      ? snapshotEnd === edge
        ? `a run must end on ${edge}`
        : `a run must end on or after ${edge} (allowed: ${edge} to ${snapshotEnd})`
      : `a run must end on or after ${edge}`;
  return { start: `${lead} ${start}.`, end: `${lead} ${end}.` };
}

/** The short form, for under the field. */
export function aggregationFieldMessages(
  year: number,
  snapshotEnd?: string
): { start: string; end: string } {
  const edge = edgeOf(year);
  return {
    start: `Start no later than ${edge}.`,
    end: snapshotEnd === edge ? `End on ${edge}.` : `End on or after ${edge}.`,
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
  const short = aggregationFieldMessages(year, snapshotEnd);
  const lastDecember = `${String(year).padStart(4, "0")}-12-30`;
  const startBreaks =
    isRealDate(start) && start !== snapshotStart && Number(start.slice(0, 4)) > year;
  const endBreaks = isRealDate(end) && end !== snapshotEnd && end < lastDecember;
  return {
    start: startBreaks ? messages.start : null,
    end: endBreaks ? messages.end : null,
    startShort: startBreaks ? short.start : null,
    endShort: endBreaks ? short.end : null,
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
