import { describe, expect, it } from "vitest";
import {
  canonicalForks,
  describeSet,
  fileName,
  forkAt,
  forkPaths,
  forkSummary,
  forkValueProblem,
  withFork,
  withoutFork,
  withoutForks,
  type DatasetFork,
} from "@/lib/workspace/dataset-forks";

const PRECIP = "/wbm/data/climate/precip/merra2_prectotcorr_d.init";
const fork = (path: string, set: Record<string, string> = {}, original = PRECIP): DatasetFork => ({ path, original, set });

describe("the list of forks", () => {
  it("is none when it is empty, and sorted by field with the values in the fixed key order", () => {
    expect(canonicalForks(null)).toBeNull();
    expect(canonicalForks([])).toBeNull();
    const list = canonicalForks([
      fork("MT_Precip.Primary", { Units: "mm/day", Var_Offset: "0", Var_Scale: "2" }),
      fork("MT_airT.Primary"),
    ])!;
    expect(list.map((f) => f.path)).toEqual(["MT_Precip.Primary", "MT_airT.Primary"]);
    expect(Object.keys(list[0].set)).toEqual(["Var_Scale", "Var_Offset", "Units"]);
    // two lists holding the same forks are the same text
    expect(JSON.stringify(canonicalForks([fork("B"), fork("A")]))).toBe(JSON.stringify(canonicalForks([fork("A"), fork("B")])));
  });

  it("replaces the fork of a field, adds one for another, and removes by field", () => {
    const one = withFork(null, fork("A", { Var_Scale: "2" }));
    expect(one).toEqual([fork("A", { Var_Scale: "2" })]);
    expect(withFork(one, fork("A", { Var_Scale: "3" }))).toEqual([fork("A", { Var_Scale: "3" })]);
    const two = withFork(one, fork("B"))!;
    expect(forkPaths(two)).toEqual(["A", "B"]);
    expect(forkAt(two, "B")).toEqual(fork("B"));
    expect(forkAt(two, "C")).toBeNull();
    expect(withoutFork(two, "A")).toEqual([fork("B")]);
    expect(withoutFork(one, "A")).toBeNull();
    expect(withoutForks(two, ["A", "B", "Z"])).toBeNull();
    expect(withoutForks(two, ["A"])).toEqual([fork("B")]);
    expect(withoutForks(null, ["A"])).toBeNull();
  });
});

describe("a value of a copy", () => {
  it("is fine when it is not set, or is a number in WBM's form, or a line of ASCII", () => {
    expect(forkValueProblem("Var_Scale", "")).toBeNull();
    expect(forkValueProblem("Var_Scale", "   ")).toBeNull();
    for (const ok of ["1.1", "95040", "-2", "2e-3", "1.", "+5", "0.5E+2"]) expect(forkValueProblem("Var_Offset", ok)).toBeNull();
    expect(forkValueProblem("Units", "mm/day")).toBeNull();
  });

  it("refuses what the backend refuses", () => {
    for (const bad of [".5", "abc", "1,5", "1e", "1e999"]) {
      expect(forkValueProblem("Var_Scale", bad), bad).toBeTruthy();
    }
    expect(forkValueProblem("Var_Scale", "0")).toMatch(/reads a Var_Scale of 0 as 1/);
    expect(forkValueProblem("Var_Offset", "0")).toBeNull();
    expect(forkValueProblem("Units", "mm/jouré")).toMatch(/ASCII/);
    expect(forkValueProblem("Units", "mm\nday")).toMatch(/single line/);
    expect(forkValueProblem("Units", "m".repeat(300))).toMatch(/At most 256/);
  });
});

describe("what a fork is called", () => {
  it("names the original by its file and says what the copy sets", () => {
    expect(fileName(PRECIP)).toBe("merra2_prectotcorr_d.init");
    expect(describeSet({ Units: "mm/day", Var_Scale: "1.1" })).toBe("Var_Scale 1.1, Units mm/day");
    expect(forkSummary(fork("MT_Precip.Primary", { Var_Scale: "1.1" }))).toBe("copy of merra2_prectotcorr_d.init, Var_Scale 1.1");
    expect(forkSummary(fork("MT_Precip.Primary"))).toBe("copy of merra2_prectotcorr_d.init (repaired)");
  });
});
