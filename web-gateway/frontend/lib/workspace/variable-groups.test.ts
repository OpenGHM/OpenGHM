import { describe, expect, it } from "vitest";
import { baseVariable, groupVariables, matchesVariable, type VariableItem } from "@/lib/workspace/variable-groups";

const items = (...names: string[]): VariableItem[] => names.map((name) => ({ name, title: null }));

describe("baseVariable", () => {
  it("is the name up to its first underscore", () => {
    expect(baseVariable("runoff_ps")).toBe("runoff");
    expect(baseVariable("IrrFlow_mm_pg")).toBe("IrrFlow");
    expect(baseVariable("runoff")).toBe("runoff");
    expect(baseVariable("glMelt")).toBe("glMelt");
    expect(baseVariable("_odd")).toBe("_odd");
  });
});

describe("groupVariables", () => {
  it("groups the names that share a base, in order of first appearance, and the rest after them", () => {
    const groups = groupVariables(
      items("runoff", "runoff_ps", "glMelt", "discharge", "irrRunoff", "discharge_ps", "runoff_pst")
    );
    expect(groups.map((g) => [g.base, g.items.map((i) => i.name)])).toEqual([
      ["runoff", ["runoff", "runoff_ps", "runoff_pst"]],
      ["discharge", ["discharge", "discharge_ps"]],
      [null, ["glMelt", "irrRunoff"]],
    ]);
  });

  it("has no trailing group when everything is grouped", () => {
    expect(groupVariables(items("a_x", "a_y")).map((g) => g.base)).toEqual(["a"]);
  });

  it("is a single 'other' group when nothing shares a base", () => {
    expect(groupVariables(items("a", "b"))).toEqual([{ base: null, items: items("a", "b") }]);
    expect(groupVariables([])).toEqual([]);
  });
});

describe("matchesVariable", () => {
  it("matches a part of the name or the title, ignoring case", () => {
    const item = { name: "soilMoist_ps", title: "Soil moisture (mm)" };
    expect(matchesVariable(item, "SOIL")).toBe(true);
    expect(matchesVariable(item, "moisture")).toBe(true);
    expect(matchesVariable(item, "_ps")).toBe(true);
    expect(matchesVariable(item, "runoff")).toBe(false);
    expect(matchesVariable(item, "  ")).toBe(true);
  });
});
