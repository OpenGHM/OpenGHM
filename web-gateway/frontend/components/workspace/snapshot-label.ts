import { coverageLabel, type CoverageBox } from "@/components/repository/coverage-thumbnail";
import { resolutionText } from "@/lib/repository/catalogue-format";
import type { Dataset } from "@/lib/repository/types";

/**
 * How the workspace names a model snapshot in short: on a card, in the
 * "based on" summary of Run settings, on Review. Everything here is read from a
 * field the spec has; nothing is parsed out of `about.name`.
 *
 * The spec has no short name and no region name for a snapshot (the DCMI `name`
 * of a spatial coverage is deliberately absent, and `slug` is a publisher's
 * identifier the catalogue may remap), so the name is the model, its version
 * and the years it covers. The long official title is the second line, never
 * the headline.
 */

/** `2000-01-01` and `2009-12-31` as "2000–2009"; one year as "2001". */
export function snapshotYears(dataset: Dataset): string {
  const { start, end } = dataset.simulation.temporalCoverage;
  const a = start.slice(0, 4);
  const b = end.slice(0, 4);
  return a === b ? a : `${a}–${b}`;
}

/** "WBM 1.0.0 · 2000–2009". */
export function snapshotName(dataset: Dataset): string {
  return `WBM ${dataset.uses.container.version} · ${snapshotYears(dataset)}`;
}

/** The bounding box the thumbnail draws. */
export function snapshotBox(dataset: Dataset): CoverageBox {
  const s = dataset.simulation.spatialCoverage;
  return { north: s.northlimit, south: s.southlimit, east: s.eastlimit, west: s.westlimit };
}

/** "Global" or "Regional", worked out from the box (see `coverageLabel`): the
 *  word the repository's map carries. */
export function snapshotExtent(dataset: Dataset): "Global" | "Regional" {
  return coverageLabel(snapshotBox(dataset));
}

/** "5 arc-min". */
export function snapshotResolution(dataset: Dataset): string {
  return resolutionText(dataset.simulation.resolution);
}
