/**
 * Where a run of a snapshot may start, for the Start date field.
 *
 * WBM writes a run's first step into band 1 of an output file, so a run can
 * only start on the first day of a file. How much one file holds is the model's
 * `File_Size`: with `year` a run starts on January 1, with `month` on the first
 * of a month. The backend reads that from the snapshot's init once and sends it
 * as `Dataset.runStartAlignment` (`DatasetDetailResponse` in
 * app/models/repository.py); `check_run_start` in app/services/run_start.py
 * applies the same rule on save and submit. This file mirrors it so the field
 * can say so while the person types.
 */
import type { Dataset } from "@/lib/repository/types";

/** `year` or `month`: a rule. `none`: the init was read and sets no rule.
 *  `null`: it could not be read, so nothing is known and nothing is blocked. */
export type RunStartAlignment = "year" | "month" | "none" | null;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const RULE_TEXT = {
  year: "This snapshot's model writes one file per year, so a run must start on January 1.",
  month: "This snapshot's model writes one file per month, so a run must start on the first day of a month.",
} as const;

/** What the rule is, in plain words; null when there is none to state. */
export function runStartRuleText(alignment: RunStartAlignment): string | null {
  return alignment === "year" || alignment === "month" ? RULE_TEXT[alignment] : null;
}

export const RUN_START_UNCHECKED =
  "We couldn't check where this model's runs may start. A start that doesn't suit it is refused once the job runs.";

const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const dayNumber = (value: string) => {
  const [y, m, d] = value.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** A full ISO date that exists: 2000-02-30 does not. */
function isRealDate(value: string): boolean {
  const m = ISO.exec(value);
  if (!m) return false;
  const date = new Date(dayNumber(value) * 86_400_000);
  return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()) === value;
}

/** The allowed start closest to `start` (the earlier on a tie), kept inside
 *  `lo`..`hi` when given; null if `start` is not a real date or nothing allowed
 *  is in range. */
export function nearestValidStart(
  alignment: RunStartAlignment,
  start: string,
  lo?: string,
  hi?: string
): string | null {
  if ((alignment !== "year" && alignment !== "month") || !isRealDate(start)) return null;
  const y = Number(start.slice(0, 4));
  const mo = Number(start.slice(5, 7));
  const candidates =
    alignment === "year"
      ? [iso(y, 1, 1), iso(y + 1, 1, 1)]
      : [iso(y, mo, 1), mo === 12 ? iso(y + 1, 1, 1) : iso(y, mo + 1, 1)];
  const inRange = candidates.filter((c) => (!lo || c >= lo) && (!hi || c <= hi));
  if (inRange.length === 0) return null;
  const from = dayNumber(start);
  return inRange.reduce((best, c) =>
    Math.abs(dayNumber(c) - from) < Math.abs(dayNumber(best) - from) ? c : best
  );
}

export interface RunStartProblem {
  /** The rule, and the way out when there is one. */
  message: string;
  /** The nearest start the rule allows, or null. */
  suggestion: string | null;
}

/**
 * Null when `start` may start a run, or when nothing is known to forbid it.
 * The snapshot's own start is the published run's and is allowed: the toolkit
 * checks a start override only. A value that is not a full date is not this
 * check's to refuse (the date field and the backend's date check do that).
 */
export function checkRunStart(
  alignment: RunStartAlignment,
  start: string,
  snapshotStart?: string,
  snapshotEnd?: string
): RunStartProblem | null {
  if ((alignment !== "year" && alignment !== "month") || start === snapshotStart) return null;
  if (!isRealDate(start)) return null;
  const month = Number(start.slice(5, 7));
  const day = Number(start.slice(8, 10));
  if (day === 1 && (alignment === "month" || month === 1)) return null;
  return {
    message: RULE_TEXT[alignment],
    suggestion: nearestValidStart(alignment, start, snapshotStart, snapshotEnd),
  };
}

/** `checkRunStart` against a snapshot, with its coverage as the range. */
export function checkRunStartFor(snapshot: Dataset | null, start: string): RunStartProblem | null {
  if (!snapshot) return null;
  const { start: lo, end: hi } = snapshot.simulation.temporalCoverage;
  return checkRunStart(snapshot.runStartAlignment ?? null, start, lo, hi);
}

/** Why a Next, Save or Submit is off for this start, or null. */
export function runStartBlockedReason(problem: RunStartProblem | null): string | null {
  return problem ? "The start date doesn't suit this model. Change it to continue." : null;
}
