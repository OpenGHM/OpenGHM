import type { CoverageBox } from "@/components/repository/coverage-thumbnail";
import { resolutionText, yearsLabel } from "@/lib/repository/catalogue-format";
import type { Dataset } from "@/lib/repository/types";

/**
 * What the workspace says about a model snapshot beside its title. The title
 * (`about.name`) is the only name a snapshot has here: nothing is made up from
 * its fields, and these facts are never joined into one. Every value is read
 * from a field the spec has.
 */

/** The bounding box the map thumbnail draws. */
export function snapshotBox(dataset: Dataset): CoverageBox {
  const s = dataset.simulation.spatialCoverage;
  return { north: s.northlimit, south: s.southlimit, east: s.eastlimit, west: s.westlimit };
}

/** The model and its code version, the years it covers, its resolution: "WBM 22.1.1",
 *  "2000–2009", "5 arc-min", the way the repository's cards write them. */
export function snapshotFacts(dataset: Dataset): string[] {
  return [
    `WBM ${dataset.uses.modelCode.version}`,
    yearsLabel(dataset.simulation.temporalCoverage),
    resolutionText(dataset.simulation.resolution),
  ];
}
