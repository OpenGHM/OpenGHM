/**
 * The Model parameters of a draft: the resolved parameter tree the gateway
 * serves for a snapshot (`GET /api/v1/repository/datasets/{id}/model-parameters`),
 * and the pure rules for editing a draft's `parameters.custom_params` with it.
 *
 * `custom_params` maps an init key path (`wbmParam.alpha`) to a string. A module
 * is switched off by `""` on its own path. A module the snapshot has off is
 * switched on by the keys it requires: a block module (`Glaciers`) by its fields,
 * each dataset chosen from the model input's `candidates`; a module that is itself
 * a dataset (`Impervious`) by a value on its own path. A key that equals the snapshot's
 * current value is not kept: the backend drops it on save, so the editor never
 * writes one, and the draft holds only real changes.
 *
 * Nothing here touches React or the network (`use-model-parameters.ts` fetches).
 * The wire names stay as the backend sends them (`code_version`, `switch_off`,
 * `show_if`).
 */

import type { DatasetFork } from "@/lib/jobs/types";
import { canonicalForks, forkAt, forkPaths, forkSummary, withFork, withoutFork } from "@/lib/workspace/dataset-forks";

export type FieldType =
  | "number"
  | "int"
  | "enum"
  | "bool01"
  | "string"
  | "date"
  | "dataset"
  | "file"
  | "list"
  | "column"
  | "block"
  | "flag";

export type Tier = "basic" | "advanced";

export interface FieldOption {
  value: string;
  label: string;
}

/** A dataset of the snapshot's model input that a field can be given: the wire
 *  shape of an entry of `candidates`. */
export interface DatasetCandidate {
  /** The data init as a run init writes it: the value of the key. */
  value: string;
  name: string;
  /** `Code_Name`: not unique in a model input, so `value` is the identity. */
  code: string;
  time_series: string;
  unit: string;
  /** Why WBM cannot read it for this field (shown, and not chosen); null when it can. */
  disabled: string | null;
  /** What a copy of it repairs, when WBM 23.9.0 refuses the file itself (a `Code_Name` that is not
   *  its file name, a non-ASCII byte): it is chosen together with a copy that sets nothing (ADR
   *  0039). Null or absent when the file is read as it is. */
  repair?: string | null;
}

export interface ParamField {
  kind: "field";
  key: string;
  label: string;
  doc: string | null;
  tier: Tier;
  /** The init key path: the key of `custom_params`. */
  path: string;
  type: FieldType;
  editable: boolean;
  /** `"number"` on a dataset field that WBM also accepts as a constant number: the
   *  wizard edits it as a number, which replaces the dataset for every grid cell.
   *  Null or absent for every other field. */
  edit_as?: "number" | null;
  /** The tree says a module that is on must set it. */
  required?: boolean;
  /** The field takes a data `.init` and the draft can edit the dataset it reads as its own copy
   *  (a fork). Whether it reads one now is for its value to say. */
  forkable?: boolean;
  /** The datasets of the model input in this field's unit that it is given one from, in a
   *  module the snapshot has off and the draft can switch on. Null or absent otherwise: a
   *  field the tree gives no unit has none, and takes a constant where `edit_as` says so. */
  candidates?: DatasetCandidate[] | null;
  /** The snapshot init's value as text; null means the key is absent. */
  current: string | null;
  /** WBM's default, resolved for the code version. */
  default: string | number | null;
  unit: string | null;
  options: FieldOption[] | null;
  min: number | null;
  max: number | null;
  /** The range a calibration usually stays in: a hint, not a limit. */
  calibration: [number, number] | null;
  /** The tree's own expression, shown and never evaluated. */
  show_if: string | null;
}

export interface ParamModule {
  kind: "module";
  key: string;
  name: string;
  doc: string | null;
  tier: Tier;
  /** The module's own init key. */
  path: string;
  /** Read from the snapshot's init. */
  state: "on" | "off";
  /** The tree allows switching it off and it is on. */
  switch_off: boolean;
  /** The snapshot has it off and everything it requires can be given from the model input. */
  switch_on?: boolean;
  /** Why not, as a sentence, when it is off and `switch_on` is false. */
  switch_on_reason?: string | null;
  /** A module that is itself a dataset can have its dataset copied (`ParamField.forkable`). */
  forkable?: boolean;
  /** A module that is itself a dataset (`Impervious`) is switched on by choosing one of these
   *  (datasets in its unit), or by a constant where `edit_as` is `"number"`. */
  candidates?: DatasetCandidate[] | null;
  edit_as?: "number" | null;
  children: ParamNode[];
}

export interface ParamGroup {
  kind: "group";
  key: string;
  label: string;
  doc: string | null;
  tier: Tier;
  children: ParamNode[];
}

export type ParamNode = ParamGroup | ParamModule | ParamField;

export interface ModelParameters {
  /** The snapshot's WBM version: "22.1.1" or "23.9.0". */
  code_version: string;
  groups: ParamNode[];
}

export type CustomParams = Record<string, string>;

/** The backend's 422 for a bad `custom_params` (`PATCH /jobs/{id}` and submit). */
export const INVALID_CUSTOM_PARAMS = "invalid_custom_params";
/** The backend's 503 when the snapshot's init could not be read. */
export const INIT_UNAVAILABLE = "init_unavailable";

/** The types the wizard edits; the others are shown, not changed. */
const EDITABLE_TYPES: ReadonlySet<FieldType> = new Set(["number", "int", "enum", "bool01", "string", "date"]);

/** Whether a field is given a dataset from the model input (a module being switched on). */
export const hasCandidates = (field: ParamField): boolean => field.candidates != null && field.candidates.length > 0;

/** A field the wizard may change: the tree says so, and its type is a scalar, or
 *  it is a dataset edited as a constant number (`edit_as`) or chosen from the
 *  model input (`candidates`). */
export const isEditableField = (field: ParamField): boolean =>
  field.editable && (EDITABLE_TYPES.has(field.type) || field.edit_as === "number" || hasCandidates(field));

/** The type the wizard treats a field as: a dataset edited as a number is a number. */
export const valueType = (field: ParamField): FieldType => (field.edit_as === "number" ? "number" : field.type);

/** Whether a field is a dataset the draft would replace with a constant number. */
export const isConstantForDataset = (field: ParamField): boolean =>
  field.edit_as === "number" && isEditableField(field) && !hasCandidates(field);

const has = (custom: CustomParams | null | undefined, path: string): boolean =>
  custom != null && Object.prototype.hasOwnProperty.call(custom, path);

// ─── Reading the tree ────────────────────────────────────────────────────────

/** Every field of the tree, depth first, module children included. */
export function allFields(nodes: readonly ParamNode[]): ParamField[] {
  return nodes.flatMap((node) =>
    node.kind === "field" ? [node] : allFields(node.children)
  );
}

/** Every module of the tree, depth first. */
export function allModules(nodes: readonly ParamNode[]): ParamModule[] {
  return nodes.flatMap((node) =>
    node.kind === "module" ? [node, ...allModules(node.children)] : node.kind === "group" ? allModules(node.children) : []
  );
}

/** The fields and modules below a node, by init key path. */
export function pathsBelow(node: ParamNode): string[] {
  if (node.kind === "field") return [node.path];
  const own = node.kind === "module" ? [node.path] : [];
  return [...own, ...node.children.flatMap(pathsBelow)];
}

/** A field or module of the tree, by init key path. */
export function indexByPath(tree: ModelParameters): Map<string, ParamField | ParamModule> {
  const found = new Map<string, ParamField | ParamModule>();
  for (const field of allFields(tree.groups)) found.set(field.path, field);
  for (const mod of allModules(tree.groups)) found.set(mod.path, mod);
  return found;
}

// ─── Values ──────────────────────────────────────────────────────────────────

/** Whether two values of a field are the same, as WBM would read them: text
 *  after trimming, and numbers (and 0/1 flags) by value. */
export function sameValue(
  type: FieldType,
  a: string | number | null | undefined,
  b: string | number | null | undefined
): boolean {
  if (a == null || b == null) return a == null && b == null;
  const x = String(a).trim();
  const y = String(b).trim();
  if (x === y) return true;
  if (type === "number" || type === "int" || type === "bool01") {
    if (x === "" || y === "") return false;
    const nx = Number(x);
    const ny = Number(y);
    return Number.isFinite(nx) && Number.isFinite(ny) && nx === ny;
  }
  return false;
}

/** The value a field has in this draft: the draft's own, else the snapshot's.
 *  Null when neither has one. */
export function effectiveValue(field: ParamField, custom: CustomParams | null | undefined): string | null {
  return has(custom, field.path) ? custom![field.path] : field.current;
}

/** Whether the draft changes this key (a field or a module). */
export function isChanged(path: string, custom: CustomParams | null | undefined): boolean {
  return has(custom, path);
}

/** Whether WBM's default is worth showing: there is one, and it is not the
 *  value the snapshot already has. */
export function defaultDiffers(field: ParamField): boolean {
  return field.default !== null && !sameValue(valueType(field), field.current, field.default);
}

/** Whether a module is on in this draft: switched off by `""`, else as the
 *  snapshot's init has it; a module the snapshot has off is on once the draft
 *  sets something of it, or while it is `opened` (switched on, nothing chosen yet). */
export function moduleIsOn(
  mod: ParamModule,
  custom: CustomParams | null | undefined,
  opened?: ReadonlySet<string>
): boolean {
  if (has(custom, mod.path)) return custom![mod.path] !== "";
  if (mod.state === "on") return true;
  return opened?.has(mod.path) === true || mod.children.flatMap(pathsBelow).some((path) => has(custom, path));
}

/** Whether the draft switches on a module the snapshot has off. */
export function isSwitchedOn(
  mod: ParamModule,
  custom: CustomParams | null | undefined,
  opened?: ReadonlySet<string>
): boolean {
  return mod.state === "off" && moduleIsOn(mod, custom, opened);
}

/** A value as a person reads it: an option's label, a flag as On/Off, and the
 *  unit after a number. `null` is "Not set". */
export function displayValue(field: ParamField, value: string | number | null): string {
  if (value === null || value === undefined) return "Not set";
  const text = String(value);
  const dataset = field.candidates?.find((c) => c.value === text);
  if (dataset) return dataset.name;
  if (field.type === "enum") {
    const option = field.options?.find((o) => o.value === text);
    return option ? option.label : text;
  }
  if (field.type === "bool01") {
    if (text === "1") return "On";
    if (text === "0") return "Off";
    return text;
  }
  // A path (a dataset a constant replaces) is no number: no unit after it.
  if (valueType(field) === "number" || field.type === "int") {
    if (field.unit && text !== "" && Number.isFinite(Number(text))) return `${text} ${field.unit}`;
  }
  return text;
}

// ─── Editing custom_params ───────────────────────────────────────────────────

/** An empty `custom_params` is none: the draft stores `null`. */
function orNull(custom: CustomParams): CustomParams | null {
  return Object.keys(custom).length === 0 ? null : custom;
}

/** Set a field to `value`. A value equal to the snapshot's current one removes
 *  the key instead (it would not be a change). */
export function setFieldValue(
  custom: CustomParams | null,
  field: ParamField,
  value: string
): CustomParams | null {
  const next = { ...custom };
  // An emptied constant is the dataset back, an emptied choice is no choice: nothing to change.
  const emptied = (field.edit_as === "number" || hasCandidates(field)) && value.trim() === "";
  if (emptied || sameValue(valueType(field), value, field.current)) delete next[field.path];
  else next[field.path] = value;
  return orNull(next);
}

/** Choose a dataset for a field of a module being switched on, and the dataset forks that go with
 *  it: a dataset that only a copy can use (`candidate.repair`) is chosen with a copy that sets
 *  nothing, and a copy of any other dataset than the one now chosen goes. */
export function chooseDataset(
  custom: CustomParams | null,
  forks: readonly DatasetFork[] | null | undefined,
  field: ParamField,
  value: string
): { custom: CustomParams | null; forks: DatasetFork[] | null } {
  const next = setFieldValue(custom, field, value);
  // A copy of the dataset now chosen stays (with what it sets); any other goes.
  const same = forkAt(forks, field.path)?.original === value;
  let kept = same ? (forks ?? null) : withoutFork(forks, field.path);
  if (field.candidates?.find((c) => c.value === value)?.repair && forkAt(kept, field.path) === null) {
    kept = withFork(kept, { path: field.path, original: value, set: {} });
  }
  return { custom: next, forks: canonicalForks(kept) };
}

/** Put a key back to the snapshot's value. */
export function resetPath(custom: CustomParams | null, path: string): CustomParams | null {
  if (!has(custom, path)) return custom;
  const next = { ...custom };
  delete next[path];
  return orNull(next);
}

/** Switch a module off: `""` on its own path. What its children were set to goes
 *  with it, since an off module has no children for WBM to read. */
export function switchOffModule(custom: CustomParams | null, mod: ParamModule): CustomParams | null {
  const next = { ...custom };
  for (const path of mod.children.flatMap(pathsBelow)) delete next[path];
  next[mod.path] = "";
  return orNull(next);
}

/** Switch a module the snapshot has off on: each required scalar starts at WBM's
 *  default. The datasets it requires are chosen by the person (`setFieldValue`);
 *  until then the module is only `opened`, and the backend refuses a save that
 *  leaves one out. */
export function switchOnModule(custom: CustomParams | null, mod: ParamModule): CustomParams | null {
  const next = { ...custom };
  for (const field of allFields(mod.children)) {
    if (field.required && field.editable && EDITABLE_TYPES.has(field.type) && field.default !== null && !has(next, field.path)) {
      next[field.path] = String(field.default);
    }
  }
  return orNull(next);
}

/** Take a module the draft switched on back off: everything set of it goes. */
export function resetModule(custom: CustomParams | null, mod: ParamModule): CustomParams | null {
  const next = { ...custom };
  for (const path of pathsBelow(mod)) delete next[path];
  return orNull(next);
}

/** The paths of `custom` (and the fields of `forks`) that are changes to something below `node`
 *  (itself included). */
export function changedBelow(
  node: ParamNode,
  custom: CustomParams | null | undefined,
  forks?: readonly DatasetFork[] | null
): string[] {
  const copied = new Set(forkPaths(forks));
  return pathsBelow(node).filter((path) => has(custom, path) || copied.has(path));
}

/** Every init key path the draft changes: its custom parameters and the fields it forks. */
export function changedPaths(parameters: {
  custom_params: CustomParams | null;
  forks?: readonly DatasetFork[] | null;
}): Record<string, string> {
  return {
    ...Object.fromEntries(forkPaths(parameters.forks).map((path) => [path, ""])),
    ...parameters.custom_params,
  };
}

// ─── Showing what changed ────────────────────────────────────────────────────

export interface ChangedEntry {
  /** `switched_on` is the line for a module the draft switches on: it has no key of its own
   *  (a block module is on by its fields), so it has no value. `fork` is a field whose dataset the
   *  run copies: `value` is the original and `shown` says what the copy sets. */
  kind: "change" | "switched_on" | "fork";
  path: string;
  /** The tree's name for it; null when the tree is not loaded or lacks the key. */
  label: string | null;
  /** The value as stored. */
  value: string;
  /** What a person reads: "switched off", an option's label, "2.5 mm". */
  shown: string;
}

/** What the draft changes, one entry per key, in key order. With the tree, a
 *  key has its label and a readable value (a dataset by its name), and a module
 *  the draft switches on has a line of its own before its keys. */
export function describeChanges(
  custom: CustomParams | null | undefined,
  tree: ModelParameters | null,
  forks?: readonly DatasetFork[] | null
): ChangedEntry[] {
  if (!custom && !(forks && forks.length > 0)) return [];
  custom = custom ?? {};
  const index = tree ? indexByPath(tree) : null;
  const copied = new Map((forks ?? []).map((f) => [f.path, f]));
  const keys = [...new Set([...Object.keys(custom), ...copied.keys()])];
  const entries: ChangedEntry[] = keys.map((path) => {
    const fork = copied.get(path);
    if (fork) {
      const node = index?.get(path);
      const label = node ? (node.kind === "module" ? node.name : node.label) : null;
      return { kind: "fork", path, label, value: fork.original, shown: forkSummary(fork) };
    }
    const value = custom[path];
    const node = index?.get(path);
    if (!node) return { kind: "change", path, label: null, value, shown: value };
    if (node.kind === "module") {
      const dataset = node.candidates?.find((c) => c.value === value);
      return { kind: "change", path, label: node.name, value, shown: value === "" ? "switched off" : (dataset?.name ?? value) };
    }
    return { kind: "change", path, label: node.label, value, shown: displayValue(node, value) };
  });
  if (tree) {
    for (const mod of allModules(tree.groups)) {
      if (isSwitchedOn(mod, custom) && !has(custom, mod.path) && !copied.has(mod.path)) {
        entries.push({ kind: "switched_on", path: mod.path, label: mod.name, value: "", shown: "switched on" });
      }
    }
  }
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.kind === "switched_on" ? -1 : 1));
}

// ─── The 422 ─────────────────────────────────────────────────────────────────

/** The per-key messages of an `invalid_custom_params` refusal, or null when the
 *  failure is anything else. (`describeFailure` puts the map in `fieldErrors`.) */
export function customParamErrors(failure: {
  code?: string;
  fieldErrors?: Record<string, string>;
}): Record<string, string> | null {
  if (failure.code !== INVALID_CUSTOM_PARAMS) return null;
  const errors = failure.fieldErrors;
  return errors && Object.keys(errors).length > 0 ? errors : null;
}

/** Whether a failure from the fetch means "this snapshot has no readable
 *  parameters", as opposed to a failure of the call. */
export function isInitUnavailable(failure: { status?: number; code?: string }): boolean {
  return failure.code === INIT_UNAVAILABLE || failure.status === 503;
}
