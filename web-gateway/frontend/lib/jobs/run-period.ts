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
 * The constraints as one line of short phrases: `Start on January 1 · End on
 * 2001-12-31 · Coverage 2000-01-01 → 2001-12-31`. A limit the coverage already
 * implies is left out (an aggregation year past the coverage's end asks nothing
 * of the start). Null when there is no snapshot to say anything about.
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
    parts.push("start date not checked here");
  }

  const phrases = parts.map(capitalize);
  phrases.push(`Coverage ${lo} → ${hi}`);
  return phrases.join(" · ");
}
