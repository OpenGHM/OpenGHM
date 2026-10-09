/**
 * What a snapshot allows of the run period, said once, as the hint under the
 * Start and End fields: where a simulation may start (`run-start.ts`), where it must
 * end (`aggregation-window.ts`), and the period the snapshot covers. A date
 * that breaks one is told on its own field; this is the line that states the
 * constraint, so nothing else has to repeat it.
 */
import { runStartRulePhrase } from "@/lib/jobs/run-start";
import type { Dataset } from "@/lib/repository/types";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * What the line says when the snapshot's init could not be read (`runStartAlignment`
 * is null: the backend's read of the init over Anvil S3 failed, or timed out
 * after 5 s, and it does not try again for 60 s; `aggregationStartYear` is
 * null with it). With no rule known the gateway checks neither date and blocks
 * nothing; `openghm sim run` still refuses a start that is not the first day of
 * a file, and WBM an end that leaves out the aggregation year, once the job
 * runs, after its wait in the queue.
 */
export const RUN_DATES_UNCHECKED =
  "couldn't read the model's date rules just now, so start and end aren't checked yet — reload to try again, or the model checks them when the run starts";

/**
 * The constraints as one line of short phrases: `Start on January 1 · End on
 * 2001-12-31 · Coverage 2000-01-01 → 2001-12-31`. A limit the coverage already
 * implies is left out (an aggregation year past the coverage's end asks nothing
 * of the start). When the rules could not be read, says so instead of a rule
 * (`RUN_DATES_UNCHECKED`). Null when there is no snapshot to say anything about.
 */
export function describeRunPeriodLimits(snapshot: Dataset | null): string | null {
  if (!snapshot) return null;
  const { start: lo, end: hi } = snapshot.simulation.temporalCoverage;
  const parts: string[] = [];

  const rule = runStartRulePhrase(snapshot.runStartAlignment ?? null);
  const year = snapshot.aggregationStartYear;
  const edge = year === null || year === undefined ? null : `${String(year).padStart(4, "0")}-12-31`;
  const startLimit = edge !== null && edge < hi ? `no later than ${edge}` : null;
  const startPhrase = rule ? (startLimit ? `${rule}, ${startLimit}` : rule) : startLimit ? `start ${startLimit}` : null;
  if (startPhrase) parts.push(startPhrase);
  if (edge !== null && edge > lo) parts.push(edge === hi ? `end on ${edge}` : `end on or after ${edge}`);
  if (snapshot.runStartAlignment === null || snapshot.runStartAlignment === undefined) {
    parts.push(RUN_DATES_UNCHECKED);
  }

  const phrases = parts.map(capitalize);
  phrases.push(`Coverage ${lo} → ${hi}`);
  return phrases.join(" · ");
}
