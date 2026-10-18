import { describe, expect, it } from "vitest";
import { displayName, listName } from "@/lib/jobs/display-name";
import { fakeDraft } from "@/lib/workspace/fixtures";

const job = (overrides: Parameters<typeof fakeDraft>[1]) =>
  fakeDraft("DRAFT", { id: "0123456789abcdef", sim_id: "", slug: null, about: null, dataset_title: "", ...overrides });

const TITLE = "WBM v2.0.0 CONUS tutorial simulation, 2000–2001";
const period = (start: string, end: string) =>
  ({ ...fakeDraft("DRAFT").parameters, temporal_range_start: start, temporal_range_end: end });

describe("displayName", () => {
  it("prefers the name its owner gave", () => {
    expect(displayName(job({ about: { name: "Run A" }, slug: "run-a", sim_id: "sim-1" }))).toBe("Run A");
  });

  it("then the slug, then the snapshot's short title with the run period, then the run id", () => {
    expect(displayName(job({ slug: "run-a", sim_id: "sim-1" }))).toBe("run-a");
    expect(
      displayName(job({ sim_id: "sim-1", dataset_title: TITLE, parameters: period("2000-01-01", "2000-12-31") }))
    ).toBe("WBM CONUS tutorial simulation · 2000");
    expect(displayName(job({ sim_id: "sim-1" }))).toBe("sim-1");
  });

  it("leaves the period out while the draft has none, and the title's own years out always", () => {
    expect(displayName(job({ dataset_title: TITLE, parameters: period("", "") }))).toBe("WBM CONUS tutorial simulation");
    expect(
      displayName(job({ dataset_title: "WBM v2.0.0 Global, GSWP3", parameters: period("2000-01-01", "2001-12-31") }))
    ).toBe("WBM Global, GSWP3 · 2000–2001");
    expect(
      displayName(
        job({ dataset_title: "WBM v1.0.0 Wyoming_tracking simulation: [Wyoming] [2000-2009]", parameters: period("2000-01-01", "2000-12-31") })
      )
    ).toBe("WBM Wyoming_tracking simulation: [Wyoming] · 2000");
  });

  it("falls back to the start of the id for a draft with nothing else", () => {
    expect(displayName(job({}))).toBe("Untitled (01234567)");
  });

  it("treats an empty name as no name", () => {
    expect(displayName(job({ about: { name: "" }, slug: "run-a" }))).toBe("run-a");
  });
});

describe("listName", () => {
  it("is the display name, with no id beside it, for a draft that has a name or a slug", () => {
    expect(listName(job({ about: { name: "Run A" }, sim_id: "sim-1" }))).toEqual({ text: "Run A", id: null });
    expect(listName(job({ slug: "run-a" }))).toEqual({ text: "run-a", id: null });
  });

  it("puts the run id beside the readable name of a draft nobody named", () => {
    const over = { dataset_title: TITLE, parameters: period("2000-01-01", "2001-12-31") };
    expect(listName(job({ ...over, sim_id: "sim-20261002-6b5577" }))).toEqual({
      text: "WBM CONUS tutorial simulation · 2000–2001",
      id: "sim-20261002-6b5577",
    });
    // Not submitted yet: no run id, so the start of its own id.
    expect(listName(job(over)).id).toBe("01234567");
  });

  it("shows the run id as the name when there is no title to make one of", () => {
    expect(listName(job({ sim_id: "sim-1" }))).toEqual({ text: "sim-1", id: null });
  });

  it("splits a draft nobody named into 'Untitled draft' and the start of its id", () => {
    expect(listName(job({}))).toEqual({ text: "Untitled draft", id: "01234567" });
  });
});
