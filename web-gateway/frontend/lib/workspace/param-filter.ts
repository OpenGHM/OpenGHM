/**
 * What the Model parameters section shows of the tree under its search, its filter and its
 * "Show advanced" switch: which nodes are visible, which are advanced, how many advanced
 * parameters the current filters hide, and the counts a group card says of itself.
 *
 * `analyzeTree` walks the tree once and answers for every node it visits, by the node itself
 * (the nodes are never copied, so a module reset still reads its own children). A module's
 * children are visited only while the module is on: an off module shows none. Nothing here
 * touches React or the network.
 */

import { isDataInit } from "@/components/workspace/model-parameters/dataset-fork-panel";
import { forkPaths, type DatasetFork } from "@/lib/workspace/dataset-forks";
import {
  changedBelow,
  effectiveValue,
  isEditableField,
  isSwitchedOn,
  moduleIsOn,
  pathsBelow,
  type CustomParams,
  type ParamField,
  type ParamGroup,
  type ParamModule,
  type ParamNode,
} from "@/lib/workspace/model-parameters";

/** What the segmented control shows: every parameter, the ones the wizard can change, or the
 *  ones the draft has changed. */
export type ParamFilter = "all" | "editable" | "changed";

/** Everything the visibility of a node depends on. */
export interface FilterInput {
  /** The search text, as typed: it is trimmed and compared without case. */
  query: string;
  filter: ParamFilter;
  showAdvanced: boolean;
  custom: CustomParams | null;
  forks: readonly DatasetFork[] | null;
  /** The backend's message by init key path. */
  errors: Record<string, string>;
  /** The modules switched on that have nothing chosen yet (`moduleIsOn`). */
  opened: ReadonlySet<string>;
}

/** What is known of one node under the filters. */
export interface NodeInfo {
  /** The node is drawn. A group with nothing visible below it is not. */
  visible: boolean;
  /** The node is advanced itself, or something above it is. */
  advanced: boolean;
  /** How many advanced parameters below the node (itself, for a field) pass the search and the
   *  filter and are hidden only because "Show advanced" is off. A module with no field counts as one. */
  hiddenAdvanced: number;
  /** How many advanced parameters are below the node, whatever the filters say. */
  advancedTotal: number;
  /** The visible fields at or below the node. */
  fields: number;
  /** The visible modules at or below the node. */
  modules: number;
  /** Of those, the fields the wizard can change and the modules it can switch. */
  editable: number;
}

const EMPTY: NodeInfo = {
  visible: false,
  advanced: false,
  hiddenAdvanced: 0,
  advancedTotal: 0,
  fields: 0,
  modules: 0,
  editable: 0,
};

/** The search text as it is compared: trimmed, without case. */
export const normalizeQuery = (query: string): string => query.trim().toLowerCase();

const includes = (query: string, ...texts: (string | null | undefined)[]): boolean =>
  texts.some((text) => text != null && text.toLowerCase().includes(query));

/** Whether a field's label, init key path, key or help text holds the search text. An empty
 *  search matches everything. */
export function fieldMatches(field: ParamField, query: string): boolean {
  const q = normalizeQuery(query);
  return q === "" || includes(q, field.label, field.path, field.key, field.doc);
}

/** Whether a module's name, init key path or help text holds the search text. */
export function moduleMatches(mod: ParamModule, query: string): boolean {
  const q = normalizeQuery(query);
  return q === "" || includes(q, mod.name, mod.path, mod.doc);
}

/** Whether a group's label holds the search text. */
export function groupMatches(group: ParamGroup, query: string): boolean {
  const q = normalizeQuery(query);
  return q === "" || includes(q, group.label);
}

/** Whether the wizard can change a field: it is editable, or it reads a data `.init` the draft
 *  can copy (an Edit dataset panel). */
export function isEditableParam(field: ParamField, custom: CustomParams | null | undefined): boolean {
  return isEditableField(field) || (field.forkable === true && isDataInit(effectiveValue(field, custom) ?? ""));
}

/** Whether the draft changes a field: a value of its own, or a copy of its dataset. */
export function isFieldChanged(
  field: ParamField,
  custom: CustomParams | null | undefined,
  forks: readonly DatasetFork[] | null | undefined
): boolean {
  return (
    (custom != null && Object.prototype.hasOwnProperty.call(custom, field.path)) ||
    forkPaths(forks).includes(field.path)
  );
}

/** Whether the person can flip a module's switch: it is on and the tree allows switching it off,
 *  the draft switched it off or on, or the snapshot has it off and the backend says it can be
 *  switched on. */
export function canToggleModule(
  mod: ParamModule,
  custom: CustomParams | null | undefined,
  opened?: ReadonlySet<string>
): boolean {
  const on = moduleIsOn(mod, custom, opened);
  const switchedOff = mod.state === "on" && !on;
  return (
    switchedOff || isSwitchedOn(mod, custom, opened) || (on && mod.switch_off) || (mod.state === "off" && mod.switch_on === true)
  );
}

/** Whether the draft changes a module: it switches it off or on, or changes something below it. */
export function isModuleChanged(
  mod: ParamModule,
  custom: CustomParams | null | undefined,
  forks: readonly DatasetFork[] | null | undefined,
  opened?: ReadonlySet<string>
): boolean {
  const on = moduleIsOn(mod, custom, opened);
  return (mod.state === "on" && !on) || isSwitchedOn(mod, custom, opened) || changedBelow(mod, custom, forks).length > 0;
}

/** A module that is off, cannot be switched on here, and holds no change and no message from the
 *  backend: the section gathers these into one quiet list. */
export function isUnavailableModule(
  mod: ParamModule,
  input: Pick<FilterInput, "custom" | "forks" | "errors" | "opened">
): boolean {
  return (
    mod.state === "off" &&
    !moduleIsOn(mod, input.custom, input.opened) &&
    mod.switch_on !== true &&
    changedBelow(mod, input.custom, input.forks).length === 0 &&
    !pathsBelow(mod).some((path) => path in input.errors)
  );
}

interface Inherited {
  /** A group or module above matched the search: everything below it does. */
  matched: boolean;
  advanced: boolean;
}

/**
 * Every node of the tree (and every child of a module that is on) as the filters leave it.
 *
 * A node is advanced if its tier is, or any ancestor's is. An advanced node is visible only with
 * "Show advanced", or when it (or something below) holds a change, a copy or a backend message, or
 * while a search is on (a search spans every tier). A field passes the search by its label, path,
 * key or help text; a module by its name, path or help text; a group by its label, and then
 * everything below it does. "Editable" keeps the fields the wizard can change and the modules it
 * can switch; "Changed" the fields and modules the draft changes.
 */
export function analyzeTree(nodes: readonly ParamNode[], input: FilterInput): Map<ParamNode, NodeInfo> {
  const found = new Map<ParamNode, NodeInfo>();
  const q = normalizeQuery(input.query);
  const walk = (node: ParamNode, inherited: Inherited): NodeInfo => {
    const advanced = inherited.advanced || node.tier === "advanced";
    let info: NodeInfo;
    if (node.kind === "field") {
      const editable = isEditableParam(node, input.custom);
      const changed = isFieldChanged(node, input.custom, input.forks);
      const textOk = q === "" || inherited.matched || fieldMatches(node, q);
      const filterOk =
        input.filter === "all" || (input.filter === "editable" ? editable : changed);
      const gateOk = !advanced || input.showAdvanced || changed || node.path in input.errors || q !== "";
      const base = textOk && filterOk;
      const visible = base && gateOk;
      info = {
        visible,
        advanced,
        hiddenAdvanced: base && !gateOk ? 1 : 0,
        advancedTotal: advanced ? 1 : 0,
        fields: visible ? 1 : 0,
        modules: 0,
        editable: visible && editable ? 1 : 0,
      };
    } else if (node.kind === "group") {
      const matched = inherited.matched || (q !== "" && groupMatches(node, q));
      info = sum(
        node.children.map((child) => walk(child, { matched, advanced })),
        advanced
      );
      info.visible = info.fields + info.modules > 0;
    } else {
      const matched = inherited.matched || (q !== "" && moduleMatches(node, q));
      const on = moduleIsOn(node, input.custom, input.opened);
      const toggle = canToggleModule(node, input.custom, input.opened);
      const changed = isModuleChanged(node, input.custom, input.forks, input.opened);
      const kids = sum(on ? node.children.map((child) => walk(child, { matched, advanced })) : [], advanced);
      const selfPass =
        (q === "" || matched) &&
        (input.filter === "all" || (input.filter === "editable" ? toggle : changed));
      const gateOk =
        !advanced ||
        input.showAdvanced ||
        changed ||
        pathsBelow(node).some((path) => path in input.errors) ||
        q !== "";
      const visible = gateOk && (selfPass || kids.fields + kids.modules > 0);
      info = {
        visible,
        advanced,
        hiddenAdvanced: gateOk ? kids.hiddenAdvanced : kids.hiddenAdvanced > 0 ? kids.hiddenAdvanced : selfPass ? 1 : 0,
        advancedTotal: kids.advancedTotal > 0 ? kids.advancedTotal : advanced ? 1 : 0,
        fields: visible ? kids.fields : 0,
        modules: visible ? kids.modules + 1 : 0,
        editable: visible ? kids.editable + (toggle ? 1 : 0) : 0,
      };
    }
    found.set(node, info);
    return info;
  };
  for (const node of nodes) walk(node, { matched: false, advanced: false });
  return found;
}

/** The counts of several nodes added up. */
function sum(infos: readonly NodeInfo[], advanced: boolean): NodeInfo {
  return infos.reduce(
    (total, info) => ({
      ...total,
      hiddenAdvanced: total.hiddenAdvanced + info.hiddenAdvanced,
      advancedTotal: total.advancedTotal + info.advancedTotal,
      fields: total.fields + info.fields,
      modules: total.modules + info.modules,
      editable: total.editable + info.editable,
    }),
    { ...EMPTY, advanced }
  );
}

/** The counts of the whole tree: what the toolbar says and what an empty result is told by. */
export function treeTotals(nodes: readonly ParamNode[], info: ReadonlyMap<ParamNode, NodeInfo>): NodeInfo {
  return sum(
    nodes.map((node) => info.get(node) ?? EMPTY),
    false
  );
}
