import { describe, expect, it, vi } from "vitest";

// A simulation that starts from a model input: no job does yet, so the source is faked.
vi.mock("@/lib/jobs/simulation-source", () => ({
  simulationSource: () => ({ kind: "model-input", id: "mi-1", title: "Ancillary Data v1", href: "/repository/model-inputs/mi-1" }),
}));

import { simulationMetaLine } from "@/lib/jobs/based-on";
import { fakeSimulation } from "@/lib/workspace/fixtures";

describe("simulationMetaLine for a source that is not a model snapshot", () => {
  it("says what the source is first, so a mixed list tells them apart", () => {
    expect(simulationMetaLine(fakeSimulation("COMPLETED"), null)).toBe("Model Input · Ancillary Data v1 · Run 2001");
  });
});
