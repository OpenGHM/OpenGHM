import { describe, expect, it } from "vitest";
import { displayName } from "@/lib/jobs/display-name";
import { fakeSimulation } from "@/lib/workspace/fixtures";

const job = (overrides: Parameters<typeof fakeSimulation>[1]) =>
  fakeSimulation("DRAFT", { id: "0123456789abcdef", sim_id: "", slug: null, about: null, ...overrides });

describe("displayName", () => {
  it("prefers the name its owner gave", () => {
    expect(displayName(job({ about: { name: "Run A" }, slug: "run-a", sim_id: "sim-1" }))).toBe("Run A");
  });

  it("then the slug, then the run id", () => {
    expect(displayName(job({ slug: "run-a", sim_id: "sim-1" }))).toBe("run-a");
    expect(displayName(job({ sim_id: "sim-1" }))).toBe("sim-1");
  });

  it("falls back to the start of the id for a draft with nothing else", () => {
    expect(displayName(job({}))).toBe("Untitled (01234567)");
  });

  it("treats an empty name as no name", () => {
    expect(displayName(job({ about: { name: "" }, slug: "run-a" }))).toBe("run-a");
  });
});
