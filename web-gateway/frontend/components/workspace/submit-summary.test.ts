import { describe, expect, it } from "vitest";
import { describeSubmitFailure } from "./submit-summary";
import type { ActionFailure } from "@/lib/jobs/types";

const failure = (code: string, message: string, fields?: string[]): Extract<ActionFailure, { reason: "error" }> => ({
  ok: false,
  reason: "error",
  message,
  status: 422,
  code,
  fields,
});

describe("describeSubmitFailure", () => {
  it("shows the backend's own sentence for a withdrawn WBM code, with its reason", () => {
    const message = "WBM code 21.0.0 was withdrawn: wrong evaporation constant. A snapshot draft on this snapshot cannot be run.";
    expect(describeSubmitFailure(failure("wbm_code_withdrawn", message))).toBe(message);
  });

  it("shows the backend's own sentence for a code that is not the one that was published", () => {
    const message = "This snapshot's code is not the WBM 23.9.0 that was published: its tree hash differs from the listed one. A snapshot draft on this snapshot cannot be run.";
    expect(describeSubmitFailure(failure("wbm_code_mismatch", message))).toBe(message);
  });

  it("still words the older refusals", () => {
    expect(describeSubmitFailure(failure("not_a_draft", "x"))).toContain("Reload the page");
  });
});
