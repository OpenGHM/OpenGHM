import { describe, expect, it } from "vitest";
import {
  allFields,
  allModules,
  changedBelow,
  customParamErrors,
  defaultDiffers,
  describeChanges,
  displayValue,
  effectiveValue,
  indexByPath,
  isChanged,
  isEditableField,
  isInitUnavailable,
  moduleIsOn,
  resetPath,
  sameValue,
  setFieldValue,
  switchOffModule,
  type ParamField,
  type ParamModule,
} from "@/lib/workspace/model-parameters";
import { fakeModelParameters } from "@/lib/workspace/fixtures";

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
      { path: "Glaciers", label: "Runoff from Glaciated Areas", value: "", shown: "switched off" },
      { path: "Other.key", label: null, value: "x", shown: "x" },
      { path: "wbmParam.Infiltration", label: "Infiltration method", value: "HBV", shown: "HBV" },
      { path: "wbmParam.maxRffStorage", label: "Runoff storage limit", value: "500", shown: "500 mm" },
    ]);
  });

  it("lists keys as they are without the tree, and nothing for no changes", () => {
    expect(describeChanges({ a: "1" }, null)).toEqual([{ path: "a", label: null, value: "1", shown: "1" }]);
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
