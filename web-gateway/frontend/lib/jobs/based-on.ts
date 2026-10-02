/**
 * What a simulation says about itself under its name in a list, and what its
 * page says it is based on: the snapshot in short, and the period it ran.
 *
 * The snapshot's short name is the one the Start screen's cards use
 * (`snapshotName`: model, version and the years it covers), plus whether it is
 * global or regional, because two snapshots of one version and period (a
 * global run and a basin of it) would otherwise read the same. Every part is a
 * field of the spec; none is parsed out of the title. The job itself carries
 * only its snapshot's id and the title it was derived under, so the snapshot is
 * read from the repository (`simulationMetaLines`, on the server); when it
 * cannot be, the job's own recorded title is what is left.
 *
 * Pure: the draft wizard, a client component, reads `basedOnLabel` too.
 */
import { kindLabel } from "@/lib/repository/catalogue-format";
import type { Dataset } from "@/lib/repository/types";
import { snapshotExtent, snapshotName } from "@/components/workspace/snapshot-label";
import { simulationSource } from "@/lib/jobs/simulation-source";
import type { Job } from "@/lib/jobs/types";

/** "WBM 2.0.0 · 2000–2001 · Regional". */
export function basedOnLabel(snapshot: Dataset): string {
  return `${snapshotName(snapshot)} · ${snapshotExtent(snapshot)}`;
}

const YEAR_START = /^(\d{4})-01-01$/;
const YEAR_END = /^(\d{4})-12-31$/;

/**
 * The period a run covers, from its two dates: "2000–2001" when it runs from a
 * January 1 to a December 31 (the usual run), otherwise the dates themselves,
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
 * The muted line under a simulation's name: what it is based on, then the
 * period it ran when that is news, which is when it is not the whole period the
 * snapshot covers (a snapshot of 2000–2009 run for all of it says so once, in
 * the snapshot's own name). A source that is not a model snapshot says what it
 * is first, so that a list that mixes the two (once a simulation can start from
 * a model input) tells them apart; the default is left unsaid.
 */
export function simulationMetaLine(job: Job, snapshot: Dataset | null): string {
  const { start, end } = {
    start: job.parameters?.temporal_range_start,
    end: job.parameters?.temporal_range_end,
  };
  const run = runPeriodLabel(start, end);
  const source = simulationSource(job);

  const parts: string[] = [];
  if (source.kind !== "snapshot") parts.push(kindLabel(source.kind));
  parts.push(snapshot ? basedOnLabel(snapshot) : source.title);

  const coverage = snapshot?.simulation.temporalCoverage;
  const wholeCoverage = coverage !== undefined && coverage.start === start && coverage.end === end;
  if (run && !wholeCoverage) parts.push(`Run ${run}`);
  return parts.join(" · ");
}
