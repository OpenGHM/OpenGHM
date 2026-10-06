/**
 * What a draft holds while it is edited, and the PATCH that saves it.
 *
 * `DraftLocal` is the editor's own copy; the last job the server answered with
 * is the baseline it is compared with. `buildDraftPatch` takes the difference
 * and sends only the groups that differ, each whole, so an edit is one small
 * PATCH and a group that did not change is never rewritten. Nothing here
 * touches React or the network: `use-draft-saver.ts` wires it to both.
 *
 * Both sides are compared in `canonical` form (trimmed text, variables in the
 * snapshot's own order). Opening a draft therefore never saves, and a value the
 * server normalises never makes the two differ for ever.
 */
import {
  describeWalltimeOverLimitShort,
  validateSlurmConfig,
  walltimeOverLimit,
} from "@/lib/jobs/compute";
import { checkAggregationWindowFor } from "@/lib/jobs/aggregation-window";
import { checkRunStartFor, isRealDate } from "@/lib/jobs/run-start";
import type {
  AboutUpdate,
  Job,
  JobParameters,
  DraftUpdateRequest,
  SlurmConfig,
  SpatialDomain,
} from "@/lib/jobs/types";
import {
  DRAFT_FIELDS,
  FIELD_LABELS,
  FIELD_STEP,
  type DraftField,
  type DraftStep,
} from "@/lib/workspace/draft-wizard";
import type { Dataset } from "@/lib/repository/types";

export type { DraftField } from "@/lib/workspace/draft-wizard";

/** `gone`: the snapshot left the repository (fetch answered null). `unavailable`:
 *  it could not be fetched at all, so every check that needs it is off and the
 *  backend decides. `dataset` is set only for `found`. */
export interface DraftContext {
  dataset: Dataset | null;
  snapshotState: "found" | "gone" | "unavailable";
}

export interface DraftLocal {
  /** What the input holds; empty means no name. */
  name: string;
  description: string;
  /** Every stored field, including a spatial subset and custom parameters the
   *  wizard cannot set but must be able to remove. */
  parameters: JobParameters;
  slurm: SlurmConfig;
  /** The stored override, or null to inherit the snapshot's. */
  modelInputId: string | null;
}

/** A draft in the form it is compared and sent in. */
interface CanonicalDraft {
  name: string | null;
  description: string | null;
  parameters: JobParameters;
  slurm: SlurmConfig;
  modelInputId: string | null;
}

/** The parts of a PATCH. They are saved, and can be refused, independently. */
type DraftGroup = "modelInput" | "parameters" | "slurm" | "about";

const GROUP_FIELDS: Record<DraftGroup, readonly DraftField[]> = {
  modelInput: ["modelInput"],
  parameters: ["start", "end", "variables", "spatial", "custom"],
  slurm: ["cores", "walltime"],
  about: ["name", "description"],
};

/** A start the server refused, and the groups it refused for another reason.
 *  Both stop applying as soon as the value they refused changes. */
export interface ServerRefusals {
  start?: { value: string; message: string; suggestion: string | null };
  groups?: Partial<
    Record<DraftGroup, { fingerprint: string; message: string; fields: DraftField[] }>
  >;
}

interface DraftPatch {
  /** Null when the server already holds everything that may be sent. */
  patch: DraftUpdateRequest | null;
  /** Fields whose local value is not in the patch and not on the server. */
  withheld: DraftField[];
  /** What the server said about a withheld field, for the field to show. */
  errors: Partial<Record<DraftField, string>>;
}

// ─── Canonical form ──────────────────────────────────────────────────────────

const clone = <T>(value: T): T => structuredClone(value);

export function fromJob(job: Job): DraftLocal {
  return {
    name: job.about?.name ?? "",
    description: job.about?.description ?? "",
    parameters: clone(job.parameters),
    slurm: {
      cores: job.slurm_config?.cores ?? null,
      walltime: job.slurm_config?.walltime ?? null,
    },
    modelInputId: job.model_input_id ?? null,
  };
}

/** The snapshot's output variables, in its own order. Empty when unknown. */
export function snapshotVariableOrder(ctx: DraftContext): string[] {
  return ctx.dataset?.simulation.outputVariables.map((v) => v.name) ?? [];
}

const blankToNull = (text: string): string | null => {
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
};

/** `run_overrides` compares `parameters.variables` with the snapshot's as lists,
 *  so they are stored in the snapshot's order; names it does not list follow in
 *  the order they were given. Each name once. */
export function orderVariables(variables: readonly string[], order: readonly string[]): string[] {
  const chosen = new Set(variables);
  const known = order.filter((name) => chosen.has(name));
  const rest = variables.filter((name) => !order.includes(name));
  return [...new Set([...known, ...rest])];
}

function canonicalDomain(domain: SpatialDomain | null): SpatialDomain | null {
  return domain
    ? { north: domain.north, south: domain.south, east: domain.east, west: domain.west }
    : null;
}

/** An empty `custom_params` is none, and keys are sorted so that two
 *  dictionaries holding the same pairs are the same text. */
function canonicalCustom(custom: Record<string, string> | null): Record<string, string> | null {
  if (!custom) return null;
  const keys = Object.keys(custom).sort();
  return keys.length === 0 ? null : Object.fromEntries(keys.map((k) => [k, custom[k]]));
}

export function canonical(local: DraftLocal, order: readonly string[] = []): CanonicalDraft {
  const p = local.parameters;
  return {
    name: blankToNull(local.name),
    description: blankToNull(local.description),
    parameters: {
      temporal_range_start: p.temporal_range_start,
      temporal_range_end: p.temporal_range_end,
      spatial_domain: canonicalDomain(p.spatial_domain),
      variables: orderVariables(p.variables, order),
      custom_params: canonicalCustom(p.custom_params),
    },
    slurm: { cores: local.slurm.cores, walltime: local.slurm.walltime },
    modelInputId: local.modelInputId,
  };
}

/** Canonical values are built with a fixed key order, so their JSON is a
 *  faithful identity for comparing and for remembering what was sent. */
export const fingerprint = (value: unknown): string => JSON.stringify(value);

/** One string for everything the local copy holds, whatever object it is in. */
export function canonicalKey(local: DraftLocal, ctx: DraftContext): string {
  return fingerprint(canonical(local, snapshotVariableOrder(ctx)));
}

/**
 * The fields whose value on screen is not what `saved` holds, in the wizard's
 * order. Both sides in canonical form, like `buildDraftPatch`, but without its
 * rules: a field the patch would leave out (a start that does not suit the
 * snapshot, a refused group) is listed here exactly because it differs.
 */
export function unsavedFields(local: DraftLocal, saved: Job, ctx: DraftContext): DraftField[] {
  const order = snapshotVariableOrder(ctx);
  const want = canonical(local, order);
  const have = canonical(fromJob(saved), order);
  const differs: Record<DraftField, boolean> = {
    modelInput: want.modelInputId !== have.modelInputId,
    start: want.parameters.temporal_range_start !== have.parameters.temporal_range_start,
    end: want.parameters.temporal_range_end !== have.parameters.temporal_range_end,
    variables: fingerprint(want.parameters.variables) !== fingerprint(have.parameters.variables),
    spatial: fingerprint(want.parameters.spatial_domain) !== fingerprint(have.parameters.spatial_domain),
    custom: fingerprint(want.parameters.custom_params) !== fingerprint(have.parameters.custom_params),
    cores: want.slurm.cores !== have.slurm.cores,
    walltime: want.slurm.walltime !== have.slurm.walltime,
    name: want.name !== have.name,
    description: want.description !== have.description,
  };
  return DRAFT_FIELDS.filter((field) => differs[field]);
}

/** True when anything on screen differs from `baseline`: what a person would
 *  lose by leaving. Compared in canonical form, so typing a space and deleting
 *  it, or the variables in another order, is not a change. */
export function isDirty(local: DraftLocal, baseline: Job, ctx: DraftContext): boolean {
  return canonicalKey(local, ctx) !== canonicalKey(fromJob(baseline), ctx);
}

// ─── The patch ───────────────────────────────────────────────────────────────

const SLURM_KEYS = ["cores", "walltime"] as const;

function refusedGroup(refusals: ServerRefusals, group: DraftGroup, sent: unknown) {
  const refusal = refusals.groups?.[group];
  return refusal && refusal.fingerprint === fingerprint(sent) ? refusal : null;
}

/**
 * The PATCH that brings the server's copy (`saved`) to the local one, or null
 * when there is nothing to send. Groups, each sent whole when it differs:
 *
 * - Model input: `model_input_id`.
 * - Run settings: `parameters` (the full object), and `slurm_config`.
 * - Name and description (Run settings): `about` as `{ name, description }` and nothing else, so the
 *   citation fields the wizard never shows are not touched. Empty becomes
 *   `null`, which the backend reads as "remove the key".
 *
 * A value that must not be sent is left out and listed in `withheld`:
 * - a start that does not suit the snapshot, or that the server refused. The
 *   backend checks a start only when it changes, so the saved start goes in its
 *   place and the rest of the parameters still save;
 * - cores or walltime that fail `validateSlurmConfig`, which the backend would
 *   answer with a 422 (a key left out is not touched, a `null` is sent as
 *   `null`: "use the snapshot's recommendation");
 * - a group the server refused with a 422, until that group's value changes.
 *
 * An empty variable list, a start after the end and a cleared date are sent:
 * the backend accepts them and only a submit refuses them (`submitProblems`).
 */
export function buildDraftPatch(
  local: DraftLocal,
  saved: Job,
  ctx: DraftContext,
  refusals: ServerRefusals = {}
): DraftPatch {
  const order = snapshotVariableOrder(ctx);
  const want = canonical(local, order);
  const have = canonical(fromJob(saved), order);
  const patch: DraftUpdateRequest = {};
  const withheld = new Set<DraftField>();
  const errors: Partial<Record<DraftField, string>> = {};

  const withhold = (fields: readonly DraftField[], message: string) => {
    for (const field of fields) {
      withheld.add(field);
      errors[field] = message;
    }
  };

  // Model & input. Only a revert (`null`) is ever sent: the API refuses to set
  // one (`model_input_choice_unavailable`, user decision 2026-10-06), and the
  // wizard has no way to choose one.
  if (want.modelInputId === null && have.modelInputId !== null) {
    const refusal = refusedGroup(refusals, "modelInput", null);
    if (refusal) withhold(refusal.fields, refusal.message);
    else patch.model_input_id = null;
  }

  // Run settings: parameters.
  let parameters = want.parameters;
  if (parameters.temporal_range_start !== have.parameters.temporal_range_start) {
    const start = parameters.temporal_range_start;
    const refused = refusals.start?.value === start ? refusals.start : null;
    const problem = refused ? null : checkRunStartFor(ctx.dataset, start);
    if (refused || problem) {
      parameters = { ...parameters, temporal_range_start: have.parameters.temporal_range_start };
      withheld.add("start");
      if (refused) errors.start = refused.message;
    }
  }
  if (fingerprint(parameters) !== fingerprint(have.parameters)) {
    const refusal = refusedGroup(refusals, "parameters", parameters);
    if (refusal) withhold(refusal.fields, refusal.message);
    else patch.parameters = parameters;
  }

  // Run settings: cores and walltime.
  const invalid = validateSlurmConfig(want.slurm);
  for (const key of SLURM_KEYS) {
    if (invalid[key] && want.slurm[key] !== have.slurm[key]) withheld.add(key);
  }
  if (SLURM_KEYS.some((key) => !invalid[key] && want.slurm[key] !== have.slurm[key])) {
    const slurm: Partial<SlurmConfig> = {};
    if (!invalid.cores) slurm.cores = want.slurm.cores;
    if (!invalid.walltime) slurm.walltime = want.slurm.walltime;
    const refusal = refusedGroup(refusals, "slurm", slurm);
    if (refusal) withhold(refusal.fields, refusal.message);
    else patch.slurm_config = slurm;
  }

  // Review.
  if (want.name !== have.name || want.description !== have.description) {
    const about: AboutUpdate = { name: want.name, description: want.description };
    const refusal = refusedGroup(refusals, "about", about);
    if (refusal) withhold(refusal.fields, refusal.message);
    else patch.about = about;
  }

  return {
    patch: Object.keys(patch).length > 0 ? patch : null,
    withheld: DRAFT_FIELDS.filter((field) => withheld.has(field)),
    errors,
  };
}

// ─── Refusals ────────────────────────────────────────────────────────────────

/** The groups a patch carries. */
function groupsOf(patch: DraftUpdateRequest): DraftGroup[] {
  const groups: DraftGroup[] = [];
  if ("model_input_id" in patch) groups.push("modelInput");
  if (patch.parameters) groups.push("parameters");
  if (patch.slurm_config) groups.push("slurm");
  if (patch.about) groups.push("about");
  return groups;
}

function groupValue(patch: DraftUpdateRequest, group: DraftGroup): unknown {
  switch (group) {
    case "modelInput":
      return patch.model_input_id;
    case "parameters":
      return patch.parameters;
    case "slurm":
      return patch.slurm_config;
    case "about":
      return patch.about;
  }
}

const PARAMETER_FIELDS: Record<string, DraftField> = {
  temporal_range_start: "start",
  temporal_range_end: "end",
  spatial_domain: "spatial",
  variables: "variables",
  custom_params: "custom",
};

/** The fields a validation error's dotted paths (`slurm_config.walltime`, see
 *  `describeFailure`) are about. A path that names a whole group names all of
 *  its fields; one that names nothing we edit names none. */
export function fieldsForPaths(paths: readonly string[]): DraftField[] {
  const found = new Set<DraftField>();
  for (const path of paths) {
    const [head, sub] = path.split(".");
    if (head === "model_input_id") found.add("modelInput");
    else if (head === "about") {
      if (sub === "name" || sub === "description") found.add(sub);
      else GROUP_FIELDS.about.forEach((f) => found.add(f));
    } else if (head === "parameters") {
      const field = sub === undefined ? undefined : PARAMETER_FIELDS[sub];
      if (field) found.add(field);
      else GROUP_FIELDS.parameters.forEach((f) => found.add(f));
    } else if (head === "slurm_config") {
      if (sub === "cores" || sub === "walltime") found.add(sub);
      else GROUP_FIELDS.slurm.forEach((f) => found.add(f));
    }
  }
  return DRAFT_FIELDS.filter((field) => found.has(field));
}

/** Remember that the server refused `start` as a run start. */
export function refuseStart(
  refusals: ServerRefusals,
  start: { value: string; message: string; suggestion: string | null }
): ServerRefusals {
  return { ...refusals, start };
}

/**
 * Remember a refusal that is not about the start (any other 422, and any other
 * 4xx that is not a conflict). It lands on the groups of `patch` the answer
 * names (`paths`, or code `invalid_about`), or on all of them when it names
 * none we can place, and holds until that group's value is a different one.
 */
export function refuseGroups(
  refusals: ServerRefusals,
  patch: DraftUpdateRequest,
  failure: { message: string; code?: string; paths?: readonly string[] }
): ServerRefusals {
  const sent = groupsOf(patch);
  const named = failure.code === "invalid_about" ? [...GROUP_FIELDS.about] : fieldsForPaths(failure.paths ?? []);
  const hit = sent.filter((g) => GROUP_FIELDS[g].some((f) => named.includes(f)));
  const targets = hit.length > 0 ? hit : sent;
  const groups = { ...refusals.groups };
  for (const group of targets) {
    const own = GROUP_FIELDS[group].filter((f) => named.includes(f));
    groups[group] = {
      fingerprint: fingerprint(groupValue(patch, group)),
      message: failure.message,
      fields: own.length > 0 ? own : [...GROUP_FIELDS[group]],
    };
  }
  return { ...refusals, groups };
}

// ─── Before a submit ─────────────────────────────────────────────────────────

export interface SubmitProblem {
  /** The field to put focus on; absent for a problem of the whole draft. */
  field?: DraftField;
  /** Where its Edit link goes. */
  step: DraftStep;
  message: string;
}

/** Why a field's local value is not in the patch, when the client can say. */
export function clientProblem(field: DraftField, local: DraftLocal, ctx: DraftContext): string | null {
  if (field === "start") {
    return checkRunStartFor(ctx.dataset, local.parameters.temporal_range_start)?.message ?? null;
  }
  if (field === "cores" || field === "walltime") {
    return validateSlurmConfig(local.slurm)[field] ?? null;
  }
  return null;
}

function isSnapshotDomain(domain: SpatialDomain, dataset: Dataset | null): boolean {
  const coverage = dataset?.simulation.spatialCoverage;
  if (!coverage) return false;
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9;
  return (
    close(domain.north, coverage.northlimit) &&
    close(domain.south, coverage.southlimit) &&
    close(domain.east, coverage.eastlimit) &&
    close(domain.west, coverage.westlimit)
  );
}

const VARIABLE_NAME = /^[A-Za-z0-9_]+$/;

/**
 * What stands between this draft and a submit, as the backend would answer it
 * (`submit_simulation` and `job_script.run_overrides`), so a person is told
 * before the click. Empty means the draft may be submitted. `withheld` and
 * `saving` come from the save itself: a value that is not saved is not what a
 * submit would run.
 */
export function submitProblems(
  local: DraftLocal,
  ctx: DraftContext,
  blockedReason: string | null,
  save: { withheld: readonly DraftField[]; saving: boolean }
): SubmitProblem[] {
  const whole: SubmitProblem[] = [];
  const byField: SubmitProblem[] = [];
  const add = (field: DraftField, message: string) =>
    byField.push({ field, step: FIELD_STEP[field], message });

  if (blockedReason) whole.push({ step: "review", message: blockedReason });
  if (ctx.snapshotState === "gone") {
    whole.push({
      step: "run",
      message:
        "The model snapshot this draft is based on is no longer in the repository, so it can't be submitted.",
    });
  }

  // Cases the toolkit has no option for (ADR 0025): a submit refuses them.
  if (local.modelInputId !== null) {
    add("modelInput", "A different model input can't run yet. Revert to the snapshot's own to submit.");
  }

  const { temporal_range_start: start, temporal_range_end: end } = local.parameters;
  const startReal = isRealDate(start);
  const endReal = isRealDate(end);
  if (!startReal) add("start", "Choose a start date that exists.");
  else {
    const rule = checkRunStartFor(ctx.dataset, start);
    if (rule) add("start", rule.message);
  }
  if (!endReal) add("end", "Choose an end date that exists.");
  else if (startReal && start > end) add("end", "The end date is before the start date.");
  // The snapshot's multi-year aggregation: WBM stops at start-up unless its
  // first year lies inside the run. An edit saves these; a submit refuses them.
  const aggregation = checkAggregationWindowFor(ctx.dataset, start, end);
  if (aggregation.start) add("start", aggregation.start);
  if (aggregation.end) add("end", aggregation.end);

  const { variables, spatial_domain: spatial, custom_params: custom } = local.parameters;
  if (variables.length === 0) add("variables", "Choose at least one output variable.");
  else if (!variables.every((name) => VARIABLE_NAME.test(name))) {
    add("variables", "Output variables must be names made of letters, digits and underscores.");
  }
  if (spatial !== null && !isSnapshotDomain(spatial, ctx.dataset)) {
    add("spatial", "A spatial subset can't run yet. Switch it off to submit.");
  }
  if (custom && Object.keys(custom).length > 0) {
    add("custom", "Custom parameters can't run yet. Remove them to submit.");
  }

  // The snapshot's reference simulation is longer than one job may be: a submit
  // refuses it (`walltime_over_limit`) unless the draft sets a walltime.
  const over = walltimeOverLimit(local.slurm, ctx.dataset?.simulation.recommendedCompute ?? null);
  if (over !== null) add("walltime", describeWalltimeOverLimitShort(over));

  // Not saved: a submit would run the saved value, not this one.
  for (const field of save.withheld) {
    add(field, `${FIELD_LABELS[field]} isn't saved yet. Fix it to continue.`);
  }

  const seen = new Set<DraftField>();
  const unique = byField.filter((problem) => {
    if (seen.has(problem.field!)) return false;
    seen.add(problem.field!);
    return true;
  });
  const waiting: SubmitProblem[] = save.saving
    ? [{ step: "review", message: "Still saving your changes." }]
    : [];
  return [...whole, ...unique, ...waiting];
}
