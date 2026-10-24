import { describe, expect, it } from "vitest";
import {
  allFields,
  allModules,
  changedBelow,
  changedPaths,
  chooseDataset,
  customParamErrors,
  defaultDiffers,
  describeChanges,
  displayValue,
  effectiveValue,
  hasCandidates,
  indexByPath,
  isChanged,
  isEditableField,
  isInitUnavailable,
  isSwitchedOn,
  moduleIsOn,
  resetModule,
  resetPath,
  sameValue,
  setFieldValue,
  switchOffModule,
  switchOnModule,
  type ParamField,
  type ParamModule,
} from "@/lib/workspace/model-parameters";
import {
  FORK_PRECIP_INIT,
  FORK_REPAIRED_INIT,
  fakeForkTree,
  fakeModelParameters,
  fakeSwitchOnTree,
} from "@/lib/workspace/fixtures";

const tree = fakeModelParameters();
const field = (path: string) => allFields(tree.groups).find((f) => f.path === path) as ParamField;
const glaciers = allModules(tree.groups)[0] as ParamModule;

describe("reading the tree", () => {
  it("lists every field and module, module children included", () => {
    expect(allFields(tree.groups).map((f) => f.path)).toContain("Glaciers.glMelt");
    expect(allModules(tree.groups).map((m) => m.path)).toEqual(["Glaciers"]);
    const index = indexByPath(tree);
    expect(index.get("wbmParam.alpha")?.kind).toBe("field");
    expect(index.get("Glaciers")?.kind).toBe("module");
  });

  it("calls a field editable when the tree says so and its type is a scalar", () => {
    expect(isEditableField(field("wbmParam.alpha"))).toBe(true);
    expect(isEditableField(field("wbmParam.RhRt2"))).toBe(false);
    expect(isEditableField({ ...field("wbmParam.alpha"), editable: false })).toBe(false);
    expect(isEditableField({ ...field("wbmParam.alpha"), type: "list" })).toBe(false);
  });

  it("calls a dataset editable only as a constant number (edit_as number) and when the tree says so", () => {
    const beta = field("wbmParam.groundWatBETA");
    expect(isEditableField(beta)).toBe(true);
    expect(isEditableField({ ...beta, editable: false })).toBe(false);
    expect(isEditableField({ ...beta, edit_as: null })).toBe(false);
  });

  it("sets and clears a constant for a dataset: an empty box is the dataset back", () => {
    const beta = field("wbmParam.groundWatBETA");
    expect(setFieldValue(null, beta, "0.02")).toEqual({ "wbmParam.groundWatBETA": "0.02" });
    expect(setFieldValue({ "wbmParam.groundWatBETA": "0.02" }, beta, "")).toBeNull();
    expect(displayValue(beta, beta.current)).toBe("/wbm/data_init/groundwater/beta.init");
    expect(displayValue(beta, "0.02")).toBe("0.02 1/day");
  });
});

describe("values", () => {
  const alpha = field("wbmParam.alpha");

  it("is the draft's value when it has one, else the snapshot's", () => {
    expect(effectiveValue(alpha, null)).toBe("5");
    expect(effectiveValue(alpha, {})).toBe("5");
    expect(effectiveValue(alpha, { "wbmParam.alpha": "7" })).toBe("7");
    expect(effectiveValue(field("wbmParam.HBV_Beta"), null)).toBeNull();
  });

  it("is changed when the draft holds the key, even with an empty value", () => {
    expect(isChanged("wbmParam.alpha", null)).toBe(false);
    expect(isChanged("wbmParam.alpha", { "wbmParam.alpha": "7" })).toBe(true);
    expect(isChanged("Glaciers", { Glaciers: "" })).toBe(true);
  });

  it("compares numbers and flags by value, other text as written", () => {
    expect(sameValue("number", "5.0", "5")).toBe(true);
    expect(sameValue("int", " 3 ", 3)).toBe(true);
    expect(sameValue("bool01", "1", 1)).toBe(true);
    expect(sameValue("number", "", "0")).toBe(false);
    expect(sameValue("string", "a", "a ")).toBe(true);
    expect(sameValue("enum", "HBV", "hbv")).toBe(false);
    expect(sameValue("number", null, null)).toBe(true);
    expect(sameValue("number", null, "0")).toBe(false);
  });

  it("shows WBM's default only when it is not what the snapshot already has", () => {
    expect(defaultDiffers(field("wbmParam.alpha"))).toBe(false);
    expect(defaultDiffers(field("wbmParam.HBV_Beta"))).toBe(true);
    expect(defaultDiffers({ ...field("wbmParam.alpha"), current: "6" })).toBe(true);
    expect(defaultDiffers({ ...field("wbmParam.alpha"), default: null })).toBe(false);
  });

  it("writes a value as a person reads it", () => {
    expect(displayValue(field("wbmParam.maxRffStorage"), "1000")).toBe("1000 mm");
    expect(displayValue(field("wbmParam.endorheicDir"), "1")).toBe("On");
    expect(displayValue(field("wbmParam.endorheicDir"), "0")).toBe("Off");
    expect(displayValue(field("wbmParam.Infiltration"), "HBV")).toBe("HBV");
    expect(displayValue(field("wbmParam.Infiltration"), null)).toBe("Not set");
    expect(displayValue(field("Comment"), "Wyoming baseline")).toBe("Wyoming baseline");
  });
});

describe("editing custom_params", () => {
  const alpha = field("wbmParam.alpha");

  it("sets a changed value, and returns a new object", () => {
    const before = { "wbmParam.Infiltration": "HBV" };
    const after = setFieldValue(before, alpha, "7");
    expect(after).toEqual({ "wbmParam.Infiltration": "HBV", "wbmParam.alpha": "7" });
    expect(before).toEqual({ "wbmParam.Infiltration": "HBV" });
  });

  it("drops the key when the value is the snapshot's, and is null when nothing is left", () => {
    expect(setFieldValue({ "wbmParam.alpha": "7" }, alpha, "5")).toBeNull();
    expect(setFieldValue({ "wbmParam.alpha": "7" }, alpha, "5.0")).toBeNull();
    expect(setFieldValue(null, alpha, "5")).toBeNull();
  });

  it("keeps an empty value for the backend to refuse, rather than guessing", () => {
    expect(setFieldValue(null, alpha, "")).toEqual({ "wbmParam.alpha": "" });
  });

  it("resets one key, and nothing else", () => {
    expect(resetPath({ a: "1", b: "2" }, "a")).toEqual({ b: "2" });
    expect(resetPath({ a: "1" }, "a")).toBeNull();
    const same = { a: "1" };
    expect(resetPath(same, "zzz")).toBe(same);
    expect(resetPath(null, "a")).toBeNull();
  });

  it("switches a module off with an empty value, and forgets what its fields were set to", () => {
    const next = switchOffModule({ "Glaciers.glRatio": "2", "wbmParam.alpha": "7" }, glaciers);
    expect(next).toEqual({ Glaciers: "", "wbmParam.alpha": "7" });
    expect(moduleIsOn(glaciers, next)).toBe(false);
    expect(moduleIsOn(glaciers, null)).toBe(true);
    expect(moduleIsOn({ ...glaciers, state: "off" }, null)).toBe(false);
    expect(resetPath(next, "Glaciers")).toEqual({ "wbmParam.alpha": "7" });
  });

  it("finds the changes below a node", () => {
    const custom = { "Glaciers.glRatio": "2", "wbmParam.alpha": "7" };
    expect(changedBelow(glaciers, custom)).toEqual(["Glaciers.glRatio"]);
    expect(changedBelow(tree.groups[1], custom)).toEqual(["wbmParam.alpha", "Glaciers.glRatio"]);
  });
});

describe("describeChanges", () => {
  it("names each change by the tree, in key order, and says what a module's empty value is", () => {
    const changes = describeChanges(
      { "wbmParam.maxRffStorage": "500", Glaciers: "", "wbmParam.Infiltration": "HBV", "Other.key": "x" },
      tree
    );
    expect(changes).toEqual([
      { kind: "change", path: "Glaciers", label: "Runoff from Glaciated Areas", value: "", shown: "switched off" },
      { kind: "change", path: "Other.key", label: null, value: "x", shown: "x" },
      { kind: "change", path: "wbmParam.Infiltration", label: "Infiltration method", value: "HBV", shown: "HBV" },
      { kind: "change", path: "wbmParam.maxRffStorage", label: "Runoff storage limit", value: "500", shown: "500 mm" },
    ]);
  });

  it("lists keys as they are without the tree, and nothing for no changes", () => {
    expect(describeChanges({ a: "1" }, null)).toEqual([
      { kind: "change", path: "a", label: null, value: "1", shown: "1" },
    ]);
    expect(describeChanges(null, tree)).toEqual([]);
  });
});

describe("the 422 and the 503", () => {
  it("reads the messages of an invalid_custom_params answer, and nothing from another", () => {
    const errors = { "wbmParam.alpha": "Enter a number." };
    expect(customParamErrors({ code: "invalid_custom_params", fieldErrors: errors })).toEqual(errors);
    expect(customParamErrors({ code: "invalid_custom_params" })).toBeNull();
    expect(customParamErrors({ code: "invalid_custom_params", fieldErrors: {} })).toBeNull();
    expect(customParamErrors({ code: "invalid_about", fieldErrors: errors })).toBeNull();
  });

  it("knows an init that could not be read", () => {
    expect(isInitUnavailable({ status: 503, code: "init_unavailable" })).toBe(true);
    expect(isInitUnavailable({ status: 503 })).toBe(true);
    expect(isInitUnavailable({ status: 500 })).toBe(false);
  });
});

describe("switching a module on", () => {
  const on = fakeSwitchOnTree();
  const fieldOf = (path: string) => allFields(on.groups).find((f) => f.path === path) as ParamField;
  const moduleOf = (path: string) => allModules(on.groups).find((m) => m.path === path) as ParamModule;
  const glacier = moduleOf("Glaciers");
  const MELT = "/wbm/data_init/glaciers/discharge_m.init";
  const AREA = "/wbm/data_init/glaciers/area_1km.init";

  it("is off until the draft sets something of it or opens it", () => {
    expect(moduleIsOn(glacier, null)).toBe(false);
    expect(isSwitchedOn(glacier, null)).toBe(false);
    expect(moduleIsOn(glacier, null, new Set(["Glaciers"]))).toBe(true);
    expect(isSwitchedOn(glacier, null, new Set(["Glaciers"]))).toBe(true);
    expect(moduleIsOn(glacier, { "Glaciers.glMelt": MELT })).toBe(true);
    // a module of another path is not opened by it
    expect(moduleIsOn(glacier, null, new Set(["Irrigation"]))).toBe(false);
    // a module that is on in the snapshot is not "switched on"
    expect(isSwitchedOn(allModules(fakeModelParameters().groups)[0], null)).toBe(false);
  });

  it("is on by its own key when it is a dataset", () => {
    const lai = moduleOf("Impervious");
    expect(moduleIsOn(lai, { Impervious: AREA })).toBe(true);
    expect(isSwitchedOn(lai, { Impervious: AREA })).toBe(true);
  });

  it("starts a required scalar at WBM's default and leaves the datasets to be chosen", () => {
    expect(switchOnModule(null, glacier)).toBeNull();
    const nitrogen = moduleOf("DIN");
    // its dataset fields have no unit, so they take constants and start unset
    expect(switchOnModule(null, nitrogen)).toEqual({ "DIN.scale": "2" });
    expect(switchOnModule({ "DIN.scale": "3" }, nitrogen)).toEqual({ "DIN.scale": "3" });
    expect(switchOnModule({ "wbmParam.alpha": "7" }, glacier)).toEqual({ "wbmParam.alpha": "7" });
  });

  it("takes a chosen dataset into custom_params and an emptied choice out", () => {
    const melt = fieldOf("Glaciers.glMelt");
    const chosen = setFieldValue(null, melt, MELT);
    expect(chosen).toEqual({ "Glaciers.glMelt": MELT });
    expect(setFieldValue(chosen, melt, "")).toBeNull();
    expect(hasCandidates(melt)).toBe(true);
    expect(isEditableField({ ...melt, editable: false })).toBe(false);
    expect(isEditableField({ ...melt, candidates: null })).toBe(false);
    expect(isEditableField(melt)).toBe(true);
  });

  it("is taken back off by Reset: everything set of the module goes, and nothing else", () => {
    const custom = { "Glaciers.glMelt": MELT, "Glaciers.glArea": AREA, "wbmParam.alpha": "7" };
    expect(resetModule(custom, glacier)).toEqual({ "wbmParam.alpha": "7" });
    expect(resetModule({ Impervious: AREA }, moduleOf("Impervious"))).toBeNull();
    expect(resetModule(null, glacier)).toBeNull();
  });

  it("is shown by a line of its own and the datasets by name", () => {
    expect(describeChanges({ "Glaciers.glMelt": MELT, "Glaciers.glArea": AREA }, on)).toEqual([
      { kind: "switched_on", path: "Glaciers", label: "Runoff from Glaciated Areas", value: "", shown: "switched on" },
      { kind: "change", path: "Glaciers.glArea", label: "Glacier area fraction", value: AREA, shown: "Glacier area fraction, 1 km" },
      { kind: "change", path: "Glaciers.glMelt", label: "Glacier melt discharge", value: MELT, shown: "Glacier discharge, monthly" },
    ]);
    // a module that is a dataset has its own key: its line is that key, and no second line
    expect(describeChanges({ Impervious: AREA }, on)).toEqual([
      { kind: "change", path: "Impervious", label: "Impervious surface runoff", value: AREA, shown: "Glacier area fraction, 1 km" },
    ]);
    // without the tree it can only list the keys
    expect(describeChanges({ "Glaciers.glMelt": MELT }, null)).toEqual([
      { kind: "change", path: "Glaciers.glMelt", label: null, value: MELT, shown: MELT },
    ]);
  });

  it("names a dataset in displayValue, and shows a path that is no candidate as it is", () => {
    const melt = fieldOf("Glaciers.glMelt");
    expect(displayValue(melt, MELT)).toBe("Glacier discharge, monthly");
    expect(displayValue(melt, "/wbm/data_init/other.init")).toBe("/wbm/data_init/other.init");
  });
});

// ─── Dataset forks (ADR 0039) ────────────────────────────────────────────────

describe("describeChanges with forks", () => {
  const forkTree = fakeForkTree();
  const precip = { path: "MT_Precip.Primary", original: FORK_PRECIP_INIT, set: { Var_Scale: "95040" } };

  it("lists a copy of a field's dataset with its label, the original and what it sets", () => {
    expect(describeChanges(null, forkTree, [precip])).toEqual([
      {
        kind: "fork",
        path: "MT_Precip.Primary",
        label: "Primary dataset",
        value: FORK_PRECIP_INIT,
        shown: "copy of merra2_prectotcorr_d.init, Var_Scale 95040",
      },
    ]);
  });

  it("lists it by its key alone without the tree, beside the custom parameters in key order", () => {
    const entries = describeChanges({ "MT_Precip.Scale": "1.2" }, null, [precip]);
    expect(entries.map((e) => [e.kind, e.path, e.label])).toEqual([
      ["fork", "MT_Precip.Primary", null],
      ["change", "MT_Precip.Scale", null],
    ]);
  });

  it("lists a repaired dataset chosen for a module once, as the copy, and the module as switched on", () => {
    const custom = { "Glaciers.glArea": FORK_REPAIRED_INIT, "Glaciers.glMelt": "/wbm/data_init/glaciers/discharge_m.init" };
    const copy = { path: "Glaciers.glArea", original: FORK_REPAIRED_INIT, set: {} };
    const entries = describeChanges(custom, forkTree, [copy]);
    expect(entries.filter((e) => e.path === "Glaciers.glArea")).toEqual([
      expect.objectContaining({ kind: "fork", shown: "copy of irrEfficiency.init (repaired)" }),
    ]);
    expect(entries.some((e) => e.kind === "switched_on" && e.path === "Glaciers")).toBe(true);
  });

  it("has nothing for an empty list", () => {
    expect(describeChanges(null, forkTree, [])).toEqual([]);
    expect(describeChanges(null, forkTree, null)).toEqual([]);
  });
});

describe("what a draft changes, with forks", () => {
  const forkTree = fakeForkTree();
  const precip = { path: "MT_Precip.Primary", original: FORK_PRECIP_INIT, set: { Var_Scale: "2" } };

  it("counts the field of a fork below a group, and lists every changed path once", () => {
    const [climate] = forkTree.groups;
    expect(changedBelow(climate, null)).toEqual([]);
    expect(changedBelow(climate, null, [precip])).toEqual(["MT_Precip.Primary"]);
    expect(changedBelow(climate, { "MT_Precip.Primary": "x" }, [precip])).toEqual(["MT_Precip.Primary"]);
    expect(Object.keys(changedPaths({ custom_params: { a: "1" }, forks: [precip] })).sort()).toEqual(["MT_Precip.Primary", "a"]);
    expect(changedPaths({ custom_params: null })).toEqual({});
  });
});

describe("chooseDataset", () => {
  const forkTree = fakeForkTree();
  const area = allFields(forkTree.groups).find((f) => f.path === "Glaciers.glArea") as ParamField;
  const ok = "/wbm/data_init/glaciers/area_1km.init";

  it("chooses a dataset WBM reads as it is, with no copy", () => {
    expect(chooseDataset(null, null, area, ok)).toEqual({ custom: { "Glaciers.glArea": ok }, forks: null });
  });

  it("chooses a repaired dataset together with a copy that sets nothing", () => {
    expect(chooseDataset(null, null, area, FORK_REPAIRED_INIT)).toEqual({
      custom: { "Glaciers.glArea": FORK_REPAIRED_INIT },
      forks: [{ path: "Glaciers.glArea", original: FORK_REPAIRED_INIT, set: {} }],
    });
  });

  it("drops the copy when another dataset is chosen, or none, and keeps one of the dataset still chosen", () => {
    const copy = [{ path: "Glaciers.glArea", original: FORK_REPAIRED_INIT, set: {} }];
    const custom = { "Glaciers.glArea": FORK_REPAIRED_INIT };
    expect(chooseDataset(custom, copy, area, ok)).toEqual({ custom: { "Glaciers.glArea": ok }, forks: null });
    expect(chooseDataset(custom, copy, area, "")).toEqual({ custom: null, forks: null });
    // another field's copy is not touched
    const other = [...copy, { path: "MT_Precip.Primary", original: FORK_PRECIP_INIT, set: { Var_Scale: "2" } }];
    expect(chooseDataset(custom, other, area, ok).forks).toEqual([other[1]]);
    // a copy of the dataset that stays chosen keeps what it sets
    const edited = [{ path: "Glaciers.glArea", original: ok, set: { Var_Scale: "2" } }];
    expect(chooseDataset({ "Glaciers.glArea": ok }, edited, area, ok).forks).toEqual(edited);
  });
});
