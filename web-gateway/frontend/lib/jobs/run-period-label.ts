/**
 * How a simulation's run period is written wherever a snapshot draft shows
 * one (the list, the simulation page): the one format, so "Run period" means
 * the same thing on both. Pure: no I/O.
 */

const YEAR_START = /^(\d{4})-01-01$/;
const YEAR_END = /^(\d{4})-12-31$/;

/**
 * The period a simulation covers, from its two dates: "2000" for one whole year,
 * "2000–2001" when it runs from a January 1 to a December 31 (the usual
 * simulation), otherwise the dates themselves, "2000-03-01 → 2000-12-31", so a
 * partial year is never rounded to a whole one. Null while either date is not
 * set (a draft that has not got that far).
 */
export function runPeriodLabel(start: string | null | undefined, end: string | null | undefined): string | null {
  if (!start || !end) return null;
  const from = YEAR_START.exec(start)?.[1];
  const to = YEAR_END.exec(end)?.[1];
  if (from && to) return from === to ? from : `${from}–${to}`;
  return `${start} → ${end}`;
}
