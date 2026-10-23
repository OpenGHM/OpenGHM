import { describe, expect, it } from "vitest";
import type { CheckFinding } from "@/lib/jobs/types";
import { checkField, checkProblems, dateMessages } from "./draft-checks";

const finding = (paths: string[], message = "m"): CheckFinding => ({
  rule: "r",
  level: "error",
  message,
  paths,
});

describe("checkField", () => {
  it("is the run start or the run end when the rule concerns one", () => {
    expect(checkField(["MT_Precip.Primary", "MT_Code_Name.Run_End"], null)).toBe("end");
    expect(checkField(["MT_Code_Name.Run_Start"], null)).toBe("start");
    // the start comes first when both are concerned
    expect(checkField(["MT_Code_Name.Run_End", "MT_Code_Name.Run_Start"], null)).toBe("start");
  });

  it("is the output variables for a rule about the output list", () => {
    expect(checkField(["Output_vars", "Runoff_mask"], null)).toBe("variables");
  });

  it("is the model parameters for a spin-up date or a key the draft changed", () => {
    expect(checkField(["MT_Precip.Primary", "Spinup.Start"], null)).toBe("custom");
    expect(checkField(["Routing.method"], { "Routing.method": "Muskingum" })).toBe("custom");
  });

  it("is none for a rule about what only the snapshot's init says", () => {
    expect(checkField(["Routing.method"], null)).toBeUndefined();
    expect(checkField(["Network", "Routing"], { "wbmParam.alpha": "3" })).toBeUndefined();
    expect(checkField([], null)).toBeUndefined();
  });
});

describe("checkProblems", () => {
  it("makes a problem of each error, with the field and the step that mend it", () => {
    expect(
      checkProblems(
        [finding(["MT_Code_Name.Run_End"], "ends late"), finding(["Output_vars"], "needs a block"), finding(["Network"], "no network")],
        null
      )
    ).toEqual([
      { field: "end", step: "run", message: "ends late" },
      { field: "variables", step: "run", message: "needs a block" },
      { step: "run", message: "no network" },
    ]);
  });

  it("makes none from no errors", () => {
    expect(checkProblems([], null)).toEqual([]);
  });
});

describe("dateMessages", () => {
  it("is the messages that concern each date, or null", () => {
    const out = dateMessages([
      finding(["MT_Code_Name.Run_End"], "ends late"),
      finding(["MT_Code_Name.Run_End", "MT_Code_Name.Run_Start"], "also starts early"),
      finding(["Output_vars"], "no date"),
    ]);
    expect(out).toEqual({ start: "also starts early", end: "ends late also starts early" });
    expect(dateMessages([])).toEqual({ start: null, end: null });
  });
});
