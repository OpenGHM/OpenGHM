/**
 * Shared state shape for the new-simulation wizard (`app/workspace/new/`).
 * Nothing here is persisted until the review step's "Save as draft" or
 * "Submit": the wizard is a local staging area over real catalogue data
 * (`Dataset`, `ModelInput`), built before a `Job` exists at all.
 */
import type { Dataset, ModelInput } from "@/lib/repository/types";
import type { Recommended } from "@/lib/jobs/compute";
import type { JobParameters, SlurmConfig } from "@/lib/jobs/types";

export const WIZARD_STEPS = ["snapshot", "model-input", "parameters", "review"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export const STEP_LABELS: Record<WizardStep, string> = {
  snapshot: "Base Model Snapshot",
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

/** Nothing chosen: a draft with no cores or walltime of its own asks SLURM
 *  for the snapshot's `recommendedCompute`, which the backend reads itself.
 *  Copying it here would pin a value the user never chose (and a snapshot's
 *  walltime may be past what a draft may ask for). */
export function defaultSlurmConfigFor(): SlurmConfig {
  return { cores: null, walltime: null };
}

/** The snapshot's own `recommendedCompute`, shown as what an empty field means. */
export function recommendedComputeFor(snapshot: Dataset): Recommended {
  return snapshot.simulation.recommendedCompute;
}
