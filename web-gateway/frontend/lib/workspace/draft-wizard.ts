/**
 * The draft wizard's own vocabulary: its steps, what they are called, the URL
 * that names one, and which step owns which field. No React here, so both the
 * server page and the pure save logic (`draft-state.ts`) can use it.
 *
 * Step 1, "Start from", is `/workspace/new` and is over once a draft exists, so
 * only the two steps of a draft are addressable. (There used to be a "Model &
 * input" step between them. Nothing on it could be changed, because the
 * toolkit has no option for a different model input, open item 9, so it was
 * dropped; `?step=model` still opens and is read as Run settings.)
 */
import type { Recommended } from "@/lib/jobs/compute";
import type { Dataset } from "@/lib/repository/types";

export const DRAFT_STEPS = ["run", "review"] as const;
export type DraftStep = (typeof DRAFT_STEPS)[number];

/** The step a draft opens at when `?step=` is missing or not one of ours. */
const DEFAULT_STEP: DraftStep = "review";

export const START_STEP_LABEL = "Start from";

export const STEP_LABELS: Record<DraftStep, string> = {
  run: "Run settings",
  review: "Review & submit",
};

/** The retired step's name: a link or a bookmark that still says it opens Run
 *  settings, where what it showed now lives. */
const RETIRED_STEP = "model";

/** `?step=` as Next hands it over (a repeated key is an array). Anything that
 *  is not a step is the default, so a stale or hand-typed link still opens. */
export function parseStep(raw: string | string[] | null | undefined): DraftStep {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === RETIRED_STEP) return "run";
  return DRAFT_STEPS.find((step) => step === value) ?? DEFAULT_STEP;
}

/** True when `raw` names the retired step, so the address bar can be rewritten
 *  to the step that replaced it. */
export function isRetiredStep(raw: string | string[] | null | undefined): boolean {
  return (Array.isArray(raw) ? raw[0] : raw) === RETIRED_STEP;
}

/** `retired` is the old "model" step, accepted so that a caller that still
 *  names it gets the address of Run settings. */
export function stepHref(id: string, step: DraftStep | typeof RETIRED_STEP): string {
  const target: DraftStep = step === RETIRED_STEP ? "run" : step;
  return `/workspace/${encodeURIComponent(id)}?step=${target}`;
}

/** The snapshot's own `recommendedCompute`, shown as what an empty cores or
 *  walltime field means. Null when the snapshot could not be loaded. */
export function recommendedComputeFor(snapshot: Dataset | null): Recommended | null {
  return snapshot ? snapshot.simulation.recommendedCompute : null;
}

/** Everything of a draft the wizard saves one field at a time. */
export const DRAFT_FIELDS = [
  "modelInput",
  "start",
  "end",
  "variables",
  "spatial",
  "custom",
  "cores",
  "walltime",
  "name",
  "description",
] as const;
export type DraftField = (typeof DRAFT_FIELDS)[number];

/** Where a field is edited: what a problem with it links to. */
export const FIELD_STEP: Record<DraftField, DraftStep> = {
  modelInput: "run",
  start: "run",
  end: "run",
  variables: "run",
  spatial: "run",
  custom: "run",
  cores: "run",
  walltime: "run",
  name: "review",
  description: "review",
};

export const FIELD_LABELS: Record<DraftField, string> = {
  modelInput: "Model input",
  start: "Start date",
  end: "End date",
  variables: "Output variables",
  spatial: "Spatial subset",
  custom: "Custom parameters",
  cores: "Cores",
  walltime: "Walltime",
  name: "Name",
  description: "Description",
};
