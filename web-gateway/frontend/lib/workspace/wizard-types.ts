/**
 * Shared state shape for the new-simulation wizard (`app/workspace/new/`).
 * Nothing here is persisted until the final submit step: the wizard is a
 * local staging area over real catalogue data (`Dataset`, `ModelInput`),
 * built before a `Job` exists at all.
 */
import type { Dataset, ModelInput } from "@/lib/repository/types";
import type { JobParameters, SlurmConfig } from "@/lib/jobs/types";

export const WIZARD_STEPS = ["snapshot", "model-input", "parameters", "review"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export const STEP_LABELS: Record<WizardStep, string> = {
  snapshot: "Base Snapshot",
  "model-input": "Model Input",
  parameters: "Parameters",
  review: "Review & Submit",
};

/**
 * Which model input the simulation will run against.
 * - `inherit`: use whatever the base snapshot's own `uses.modelInput.id`
 *   resolves to — the common case, and the one that can turn out to be
 *   `inherited-missing` (see `resolveInheritedModelInput` in
 *   `wizard-model-input-step.tsx`).
 * - `chosen`: run against a different published model input instead.
 */
export type ModelInputChoice =
  | { mode: "inherit" }
  | { mode: "chosen"; modelInput: ModelInput };

export interface WizardState {
  snapshot: Dataset | null;
  modelInputChoice: ModelInputChoice;
  parameters: JobParameters | null;
  slurmConfig: SlurmConfig | null;
}

export const INITIAL_WIZARD_STATE: WizardState = {
  snapshot: null,
  modelInputChoice: { mode: "inherit" },
  parameters: null,
  slurmConfig: null,
};

/** Parameter defaults straight from the base snapshot's own `simulation`
 *  block — rule 5: these are the snapshot's real values, not invented ones. */
export function defaultParametersFor(snapshot: Dataset): JobParameters {
  return {
    temporal_range_start: snapshot.simulation.temporalCoverage.start,
    temporal_range_end: snapshot.simulation.temporalCoverage.end,
    spatial_domain: null,
    variables: snapshot.simulation.outputVariables.map((v) => v.name),
    custom_params: null,
  };
}

/** SLURM defaults from the snapshot's `recommendedCompute` — the closest
 *  real hint the spec has to "how big a job is this." Partition/account are
 *  gateway conventions (see the pre-wizard review page), not spec fields. */
export function defaultSlurmConfigFor(snapshot: Dataset): SlurmConfig {
  return {
    partition: "shared",
    account: null,
    walltime: snapshot.simulation.recommendedCompute.walltime,
    nodes: 1,
    ntasks: snapshot.simulation.recommendedCompute.cores,
    memory: null,
  };
}
