import { describe, expect, it, vi } from "vitest";
import {
  FORK_PRECIP_INIT,
  fakeForkTree,
  fakeModelParameters,
  fakeParamField,
  fakeSwitchOnTree,
} from "@/lib/workspace/fixtures";
import type { ModelParameters, ParamGroup, ParamModule, ParamNode } from "@/lib/workspace/model-parameters";
import {
  analyzeTree,
  canToggleModule,
  fieldMatches,
  groupMatches,
  isEditableParam,
  isFieldChanged,
  isModuleChanged,
  isUnavailableModule,
  moduleMatches,
  normalizeQuery,
  treeTotals,
  type FilterInput,
} from "@/lib/workspace/param-filter";

// The fork panel (imported for `isDataInit`) reads datasets through a server action.
vi.mock("@/lib/repository/actions", () => ({ fetchDatasetInit: vi.fn() }));

const INPUT: FilterInput = {
  query: "",
  filter: "all",
  showAdvanced: false,
  custom: null,
  forks: null,
  errors: {},
  opened: new Set(),
};

const search = (nodes: readonly ParamNode[], key: string): ParamNode | null => {
  for (const node of nodes) {
    if (node.key === key) return node;
    const inner = node.kind === "field" ? null : search(node.children, key);
    if (inner) return inner;
  }
  return null;
};

const find = (nodes: readonly ParamNode[], key: string): ParamNode => {
  const node = search(nodes, key);
  if (!node) throw new Error(`no node ${key}`);
  return node;
};

const moduleOf = (tree: ModelParameters, key: string) => find(tree.groups, key) as ParamModule;

describe("matching the search text", () => {
  it("trims and ignores case", () => {
    expect(normalizeQuery("  Alpha ")).toBe("alpha");
  });

  it("matches a field by its label, path, key and help text, and an empty search matches all", () => {
    const field = fakeParamField("wbmParam.alpha", { key: "alpha_key", label: "Soil drying", doc: "Larger is drier." });
    for (const text of ["SOIL", "wbmparam.al", "alpha_k", "drier"]) expect(fieldMatches(field, text)).toBe(true);
    expect(fieldMatches(field, "nothing")).toBe(false);
    expect(fieldMatches(field, "  ")).toBe(true);
  });

  it("matches a module by its name, path and help text, and a group by its label alone", () => {
    const mod = moduleOf(fakeModelParameters(), "glaciated_area_runoff");
    for (const text of ["glaciated", "glaciers", "rasterized"]) expect(moduleMatches(mod, text)).toBe(true);
    expect(moduleMatches(mod, "glaciated_area_runoff")).toBe(false);
    const group = find(fakeModelParameters().groups, "run") as ParamGroup;
    expect(groupMatches(group, "RUN")).toBe(true);
    expect(groupMatches(group, "Comment")).toBe(false);
  });
});

describe("what the wizard can change and what the draft changes", () => {
  it("counts an editable field, and a dataset the draft can copy while it reads a data init", () => {
    const tree = fakeForkTree();
    const primary = find(tree.groups, "primary") as ReturnType<typeof fakeParamField>;
    expect(isEditableParam(primary, null)).toBe(true);
    // the value the draft gives it decides, and so does the tree's say
    expect(isEditableParam(primary, { "MT_Precip.Primary": "/somewhere/else" })).toBe(false);
    expect(isEditableParam({ ...primary, forkable: false }, null)).toBe(false);
    expect(isEditableParam(fakeParamField("A.b", { editable: false }), null)).toBe(false);
    expect(isEditableParam(fakeParamField("A.b"), null)).toBe(true);
  });

  it("calls a field changed by a value or by a copy", () => {
    const field = fakeParamField("MT_Precip.Primary");
    expect(isFieldChanged(field, null, null)).toBe(false);
    expect(isFieldChanged(field, { "MT_Precip.Primary": "1" }, null)).toBe(true);
    expect(isFieldChanged(field, null, [{ path: "MT_Precip.Primary", original: FORK_PRECIP_INIT, set: {} }])).toBe(true);
  });

  it("lets a module be toggled when it is on and can go off, was switched, or can be switched on", () => {
    const tree = fakeModelParameters();
    const mod = moduleOf(tree, "glaciated_area_runoff");
    expect(canToggleModule(mod, null)).toBe(true);
    expect(canToggleModule({ ...mod, switch_off: false }, null)).toBe(false);
    // the draft switched it off: it can be put back, whatever the tree says of switching off
    expect(canToggleModule({ ...mod, switch_off: false }, { Glaciers: "" })).toBe(true);
    const off = moduleOf(fakeSwitchOnTree(), "glaciated_area_runoff");
    expect(canToggleModule(off, null)).toBe(true);
    expect(canToggleModule({ ...off, switch_on: false }, null)).toBe(false);
    // switched on by what the draft sets, or by opening it
    expect(canToggleModule({ ...off, switch_on: false }, { "Glaciers.glMelt": "x" })).toBe(true);
    expect(canToggleModule({ ...off, switch_on: false }, null, new Set(["Glaciers"]))).toBe(true);
  });

  it("calls a module changed when it is switched, or something below it is", () => {
    const mod = moduleOf(fakeModelParameters(), "glaciated_area_runoff");
    expect(isModuleChanged(mod, null, null)).toBe(false);
    expect(isModuleChanged(mod, { Glaciers: "" }, null)).toBe(true);
    expect(isModuleChanged(mod, { "Glaciers.glRatio": "2" }, null)).toBe(true);
    const off = moduleOf(fakeSwitchOnTree(), "glaciated_area_runoff");
    expect(isModuleChanged(off, null, null)).toBe(false);
    expect(isModuleChanged(off, null, null, new Set(["Glaciers"]))).toBe(true);
  });

  it("calls a module unavailable when it is off, cannot be switched on, and holds no change or message", () => {
    const tree = fakeSwitchOnTree();
    const irrigation = moduleOf(tree, "irrigated_crops");
    expect(isUnavailableModule(irrigation, INPUT)).toBe(true);
    expect(isUnavailableModule(irrigation, { ...INPUT, errors: { Irrigation: "no" } })).toBe(false);
    expect(isUnavailableModule(irrigation, { ...INPUT, custom: { "Irrigation.ReturnCoeff": "1" } })).toBe(false);
    expect(isUnavailableModule(moduleOf(tree, "glaciated_area_runoff"), INPUT)).toBe(false);
    expect(isUnavailableModule(moduleOf(fakeModelParameters(), "glaciated_area_runoff"), INPUT)).toBe(false);
  });
});

describe("analyzing the tree", () => {
  const tree = fakeModelParameters();
  const info = (input: Partial<FilterInput> = {}, t: ModelParameters = tree) => {
    const map = analyzeTree(t.groups, { ...INPUT, ...input });
    return { map, at: (key: string) => map.get(find(t.groups, key))!, totals: treeTotals(t.groups, map) };
  };

  it("hides advanced fields until Show advanced, and counts them", () => {
    const hidden = info();
    expect(hidden.at("max_rff_storage")).toMatchObject({ visible: false, advanced: true, hiddenAdvanced: 1 });
    expect(hidden.at("alpha")).toMatchObject({ visible: true, advanced: false });
    expect(hidden.at("hydrology_params")).toMatchObject({ visible: true, hiddenAdvanced: 2, advancedTotal: 2 });
    expect(hidden.totals.advancedTotal).toBe(2);
    const shown = info({ showAdvanced: true });
    expect(shown.at("max_rff_storage")).toMatchObject({ visible: true, hiddenAdvanced: 0 });
    expect(shown.at("hydrology_params").hiddenAdvanced).toBe(0);
  });

  it("shows an advanced field that holds a change, a copy or a message, and while a search is on", () => {
    expect(info({ custom: { "wbmParam.maxRffStorage": "5" } }).at("max_rff_storage").visible).toBe(true);
    expect(info({ errors: { "wbmParam.maxRffStorage": "bad" } }).at("max_rff_storage").visible).toBe(true);
    expect(info({ custom: { "wbmParam.maxRffStorage": "5" } }).at("hbv_beta").visible).toBe(false);
    expect(info({ query: "storage" }).at("max_rff_storage").visible).toBe(true);
  });

  it("makes everything below an advanced group advanced", () => {
    const nested: ModelParameters = {
      code_version: "23.9.0",
      groups: [
        {
          kind: "group",
          key: "other",
          label: "Other",
          doc: null,
          tier: "advanced",
          children: [
            {
              kind: "group",
              key: "inner",
              label: "Inner",
              doc: null,
              tier: "basic",
              children: [fakeParamField("X.y", { key: "y", label: "Y" })],
            },
          ],
        },
      ],
    };
    const hidden = info({}, nested);
    expect(hidden.at("y")).toMatchObject({ visible: false, advanced: true, hiddenAdvanced: 1 });
    expect(hidden.at("other")).toMatchObject({ visible: false, hiddenAdvanced: 1, advancedTotal: 1 });
    expect(info({ showAdvanced: true }, nested).at("other").visible).toBe(true);
    expect(info({ custom: { "X.y": "1" } }, nested).at("other").visible).toBe(true);
  });

  it("counts the parameters, modules and editable things of a group", () => {
    const run = info().at("run");
    expect(run).toMatchObject({ fields: 3, modules: 0, editable: 3 });
    // 5 fields and the 2 of the module (it is on), the module, and the advanced ones not counted
    expect(info().at("hydrology_params")).toMatchObject({ fields: 7, modules: 1, editable: 6 });
    expect(info({ showAdvanced: true }).at("hydrology_params")).toMatchObject({ fields: 9, editable: 8 });
  });

  it("shows a whole group when its label matches, and only what matches otherwise", () => {
    expect(info({ query: "run" }).at("title").visible).toBe(true);
    expect(info({ query: "run" }).at("start").visible).toBe(true);
    const spin = info({ query: "spin" });
    expect(spin.at("loops").visible).toBe(true);
    expect(spin.at("title").visible).toBe(false);
    expect(spin.at("run").visible).toBe(true);
    expect(spin.at("hydrology_params").visible).toBe(false);
    expect(info({ query: "zzz" }).totals).toMatchObject({ fields: 0, modules: 0 });
  });

  it("shows a module that matches with its settings, and a module that does not only for a setting that does", () => {
    const byModule = info({ query: "glaciated" });
    expect(byModule.at("glaciated_area_runoff").visible).toBe(true);
    expect(byModule.at("ratio").visible).toBe(true);
    expect(byModule.at("alpha").visible).toBe(false);
    const bySetting = info({ query: "melt ratio" });
    expect(bySetting.at("glaciated_area_runoff").visible).toBe(true);
    expect(bySetting.at("ratio").visible).toBe(true);
    expect(bySetting.at("melt").visible).toBe(false);
  });

  it("keeps Editable to what can be changed, and Changed to what the draft changed", () => {
    const editable = info({ filter: "editable" });
    expect(editable.at("rhrt2").visible).toBe(false);
    expect(editable.at("alpha").visible).toBe(true);
    expect(editable.at("glaciated_area_runoff").visible).toBe(true);
    expect(editable.at("melt").visible).toBe(false);
    const changed = info({ filter: "changed", custom: { "wbmParam.alpha": "7" } });
    expect(changed.at("alpha").visible).toBe(true);
    expect(changed.at("infiltration").visible).toBe(false);
    expect(changed.at("glaciated_area_runoff").visible).toBe(false);
    expect(changed.at("run").visible).toBe(false);
    // a module switched off is a change; so is a change inside it
    expect(info({ filter: "changed", custom: { Glaciers: "" } }).at("glaciated_area_runoff").visible).toBe(true);
    const inside = info({ filter: "changed", custom: { "Glaciers.glRatio": "2" } });
    expect(inside.at("glaciated_area_runoff").visible).toBe(true);
    expect(inside.at("ratio").visible).toBe(true);
    expect(inside.at("melt").visible).toBe(false);
  });

  it("does not visit the children of a module that is off", () => {
    const off = fakeSwitchOnTree();
    const { map } = info({}, off);
    const glaciers = moduleOf(off, "glaciated_area_runoff");
    expect(map.get(glaciers)?.visible).toBe(true);
    expect(map.get(glaciers.children[0])).toBeUndefined();
    const opened = info({ opened: new Set(["Glaciers"]) }, off);
    expect(opened.map.get(glaciers.children[0])?.visible).toBe(true);
  });

  it("hides a module that cannot be switched on from Editable and Changed, and shows it in All", () => {
    const off = fakeSwitchOnTree();
    expect(info({}, off).at("irrigated_crops").visible).toBe(true);
    expect(info({ filter: "editable" }, off).at("irrigated_crops").visible).toBe(false);
    expect(info({ filter: "changed" }, off).at("irrigated_crops").visible).toBe(false);
  });

  it("counts an advanced module with nothing in it as one hidden parameter", () => {
    const only: ModelParameters = {
      code_version: "23.9.0",
      groups: [
        {
          kind: "group",
          key: "modules",
          label: "Modules",
          doc: null,
          tier: "basic",
          children: [{ ...moduleOf(fakeSwitchOnTree(), "impervious_surface_runoff"), tier: "advanced" }],
        },
      ],
    };
    const hidden = info({}, only);
    expect(hidden.at("modules")).toMatchObject({ visible: false, hiddenAdvanced: 1, advancedTotal: 1 });
    expect(info({ showAdvanced: true }, only).at("modules").visible).toBe(true);
  });
});
