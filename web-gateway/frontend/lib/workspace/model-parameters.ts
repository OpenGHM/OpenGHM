/**
 * The Model parameters of a draft: the resolved parameter tree the gateway
 * serves for a snapshot (`GET /api/v1/repository/datasets/{id}/model-parameters`),
 * and the pure rules for editing a draft's `parameters.custom_params` with it.
 *
 * `custom_params` maps an init key path (`wbmParam.alpha`) to a string. A module
 * is switched off by `""` on its own path. A key that equals the snapshot's
 * current value is not kept: the backend drops it on save, so the editor never
 * writes one, and the draft holds only real changes.
 *
 * Nothing here touches React or the network (`use-model-parameters.ts` fetches).
 * The wire names stay as the backend sends them (`code_version`, `switch_off`,
 * `show_if`).
 */

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

/** A field the wizard may change: the tree says so, and its type is a scalar or
 *  it is a dataset edited as a constant number (`edit_as`). */
export const isEditableField = (field: ParamField): boolean =>
  field.editable && (EDITABLE_TYPES.has(field.type) || field.edit_as === "number");

/** The type the wizard treats a field as: a dataset edited as a number is a number. */
export const valueType = (field: ParamField): FieldType => (field.edit_as === "number" ? "number" : field.type);

/** Whether a field is a dataset the draft would replace with a constant number. */
export const isConstantForDataset = (field: ParamField): boolean =>
  field.edit_as === "number" && isEditableField(field);

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
 *  snapshot's init has it. */
export function moduleIsOn(mod: ParamModule, custom: CustomParams | null | undefined): boolean {
  if (has(custom, mod.path)) return custom![mod.path] !== "";
  return mod.state === "on";
}

/** A value as a person reads it: an option's label, a flag as On/Off, and the
 *  unit after a number. `null` is "Not set". */
export function displayValue(field: ParamField, value: string | number | null): string {
  if (value === null || value === undefined) return "Not set";
  const text = String(value);
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
  // An emptied constant is the dataset back: nothing to change.
  const emptied = field.edit_as === "number" && value.trim() === "";
  if (emptied || sameValue(valueType(field), value, field.current)) delete next[field.path];
  else next[field.path] = value;
  return orNull(next);
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

/** The paths of `custom` that are changes to something below `node` (itself included). */
export function changedBelow(node: ParamNode, custom: CustomParams | null | undefined): string[] {
  return pathsBelow(node).filter((path) => has(custom, path));
}

// ─── Showing what changed ────────────────────────────────────────────────────

export interface ChangedEntry {
  path: string;
  /** The tree's name for it; null when the tree is not loaded or lacks the key. */
  label: string | null;
  /** The value as stored. */
  value: string;
  /** What a person reads: "switched off", an option's label, "2.5 mm". */
  shown: string;
}

/** What the draft changes, one entry per key, in key order. With the tree, a
 *  key has its label and a readable value. */
export function describeChanges(custom: CustomParams | null | undefined, tree: ModelParameters | null): ChangedEntry[] {
  if (!custom) return [];
  const index = tree ? indexByPath(tree) : null;
  return Object.keys(custom)
    .sort()
    .map((path) => {
      const value = custom[path];
      const node = index?.get(path);
      if (!node) return { path, label: null, value, shown: value };
      if (node.kind === "module") {
        return { path, label: node.name, value, shown: value === "" ? "switched off" : value };
      }
      return { path, label: node.label, value, shown: displayValue(node, value) };
    });
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
