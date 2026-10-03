import { describe, expect, it } from "vitest";
import { fakeDataset } from "@/lib/workspace/fixtures";
import {
  DRAFT_FIELDS,
  DRAFT_STEPS,
  FIELD_LABELS,
  FIELD_STEP,
  START_STEP_LABEL,
  STEP_LABELS,
  isRetiredStep,
  newStepHref,
  newWizardPath,
  parseStep,
  recommendedComputeFor,
  stepHref,
} from "@/lib/workspace/draft-wizard";

describe("the steps", () => {
  it("are run and review, in that order, with the words a person reads", () => {
    expect(DRAFT_STEPS).toEqual(["run", "review"]);
    expect(START_STEP_LABEL).toBe("Start from");
    expect(STEP_LABELS).toEqual({
      run: "Run settings",
      review: "Review & submit",
    });
  });
});

describe("parseStep", () => {
  it.each(["run", "review"] as const)("reads %s", (step) => {
    expect(parseStep(step)).toBe(step);
  });

  it("reads the retired model step as Run settings", () => {
    expect(parseStep("model")).toBe("run");
    expect(parseStep(["model", "review"])).toBe("run");
    expect(isRetiredStep("model")).toBe(true);
    expect(isRetiredStep(["model"])).toBe(true);
    expect(isRetiredStep("run")).toBe(false);
    expect(isRetiredStep(null)).toBe(false);
  });

  it("opens at Review when the step is missing or not one of ours", () => {
    for (const raw of [undefined, null, "", "start", "Model", "run ", "../x"]) {
      expect(parseStep(raw)).toBe("review");
    }
  });

  it("reads the first of a repeated key", () => {
    expect(parseStep(["run", "review"])).toBe("run");
    expect(parseStep(["nope", "run"])).toBe("review");
    expect(parseStep([])).toBe("review");
  });
});

describe("stepHref", () => {
  it("names the draft and the step", () => {
    expect(stepHref("abc-123", "run")).toBe("/workspace/abc-123?step=run");
  });

  it("points a caller that still says model at Run settings", () => {
    expect(stepHref("abc-123", "model")).toBe("/workspace/abc-123?step=run");
  });

  it("round-trips through parseStep", () => {
    for (const step of DRAFT_STEPS) {
      const raw = new URL(stepHref("x", step), "http://h").searchParams.get("step");
      expect(parseStep(raw)).toBe(step);
    }
  });

  it("encodes an id that is not a plain path segment", () => {
    expect(stepHref("a/b?c", "run")).toBe("/workspace/a%2Fb%3Fc?step=run");
  });
});

describe("parseStep with a fallback", () => {
  it("opens a new simulation at Run settings when the step is missing or not one of ours", () => {
    for (const raw of [undefined, null, "", "start", "../x", []]) {
      expect(parseStep(raw, "run")).toBe("run");
    }
  });

  it("still reads a step that is named", () => {
    expect(parseStep("review", "run")).toBe("review");
    expect(parseStep("run", "review")).toBe("run");
    expect(parseStep("model", "review")).toBe("run");
  });
});

describe("newStepHref", () => {
  it("names the snapshot and the step, under /workspace/new", () => {
    expect(newStepHref("snap-1", "run")).toBe("/workspace/new/snap-1?step=run");
    expect(newStepHref("snap-1", "review")).toBe("/workspace/new/snap-1?step=review");
  });

  it("encodes an id that is not a plain path segment, as the page's own path does", () => {
    expect(newStepHref("a/b?c", "run")).toBe("/workspace/new/a%2Fb%3Fc?step=run");
    expect(newWizardPath("a/b?c")).toBe("/workspace/new/a%2Fb%3Fc");
  });

  it("round-trips through parseStep", () => {
    for (const step of DRAFT_STEPS) {
      const raw = new URL(newStepHref("x", step), "http://h").searchParams.get("step");
      expect(parseStep(raw, "run")).toBe(step);
    }
  });
});

describe("recommendedComputeFor", () => {
  it("is the snapshot's own recommendation", () => {
    expect(recommendedComputeFor(fakeDataset())).toEqual({ cores: 16, walltime: "15:00" });
  });

  it("is null when the snapshot is not known", () => {
    expect(recommendedComputeFor(null)).toBeNull();
  });
});

describe("the fields", () => {
  it("each belong to a step and have a label", () => {
    for (const field of DRAFT_FIELDS) {
      expect(DRAFT_STEPS).toContain(FIELD_STEP[field]);
      expect(FIELD_LABELS[field].length).toBeGreaterThan(0);
    }
  });

  it("are edited where the wizard puts them", () => {
    expect(FIELD_STEP.modelInput).toBe("run");
    for (const field of ["modelInput", "start", "end", "variables", "spatial", "custom", "cores", "walltime"] as const) {
      expect(FIELD_STEP[field]).toBe("run");
    }
    expect(FIELD_STEP.name).toBe("run");
    expect(FIELD_STEP.description).toBe("run");
  });
});
