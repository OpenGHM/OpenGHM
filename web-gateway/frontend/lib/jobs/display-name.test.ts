import { describe, expect, it } from "vitest";
import { aboutName, basedOnName, displayName, listName } from "@/lib/jobs/display-name";
import { fakeDraft } from "@/lib/workspace/fixtures";

const job = (overrides: Parameters<typeof fakeDraft>[1]) =>
  fakeDraft("DRAFT", { id: "0123456789abcdef", sim_id: "", slug: null, about: null, ...overrides });

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

describe("listName", () => {
  it("is the display name for anything that has a name, a slug or a run id", () => {
    expect(listName(job({ about: { name: "Run A" } }))).toEqual({ text: "Run A", id: null });
    expect(listName(job({ slug: "run-a" }))).toEqual({ text: "run-a", id: null });
    expect(listName(job({ sim_id: "sim-1" }))).toEqual({ text: "sim-1", id: null });
  });

  it("splits a draft nobody named into 'Untitled draft' and the start of its id", () => {
    expect(listName(job({}))).toEqual({ text: "Untitled draft", id: "01234567" });
  });
});

describe("aboutName", () => {
  it("is the short name when there is one", () => {
    expect(aboutName({ name: "The full, citable title of a paper", shortName: "WBM v1 Global" })).toBe("WBM v1 Global");
  });

  it("is the name, exactly as before, when there is no short name", () => {
    expect(aboutName({ name: "The full title" })).toBe("The full title");
    expect(aboutName({ name: "The full title", shortName: null })).toBe("The full title");
    expect(aboutName({ name: "The full title", shortName: undefined })).toBe("The full title");
  });

  it("treats an empty or blank short name as none", () => {
    expect(aboutName({ name: "The full title", shortName: "" })).toBe("The full title");
    expect(aboutName({ name: "The full title", shortName: "   " })).toBe("The full title");
  });
});

describe("basedOnName", () => {
  it("is the short name copied onto the job, else the title it was made with", () => {
    expect(basedOnName({ dataset_title: "Full title", dataset_short_title: "Short" })).toBe("Short");
    expect(basedOnName({ dataset_title: "Full title", dataset_short_title: null })).toBe("Full title");
    expect(basedOnName({ dataset_title: "Full title" })).toBe("Full title");
  });
});
