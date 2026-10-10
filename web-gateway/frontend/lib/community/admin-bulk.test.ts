import { describe, expect, it } from "vitest";
import { bulkFailure, nameList, nounFor, selectionState, stateChangeSummary } from "@/lib/community/admin-bulk";

describe("selectionState", () => {
  it("is all, some or none of the rows", () => {
    expect(selectionState(3, 3)).toBe(true);
    expect(selectionState(3, 1)).toBe("indeterminate");
    expect(selectionState(3, 0)).toBe(false);
    expect(selectionState(0, 0)).toBe(false);
  });
});

describe("nameList", () => {
  it("lists up to three names and counts the rest", () => {
    expect(nameList(["A"])).toBe("“A”");
    expect(nameList(["A", "B"])).toBe("“A” and “B”");
    expect(nameList(["A", "B", "C"])).toBe("“A”, “B” and “C”");
    expect(nameList(["A", "B", "C", "D", "E"])).toBe("“A”, “B”, “C” and 2 more");
    expect(nameList([])).toBe("");
  });
});

describe("nounFor", () => {
  it("is singular for one and plural otherwise", () => {
    expect(nounFor("workshops", 1)).toBe("workshop");
    expect(nounFor("files", 0)).toBe("files");
    expect(nounFor("publications", 2)).toBe("publications");
  });
});

describe("stateChangeSummary", () => {
  const titles = new Map([["b", "Beta"], ["c", "Gamma"]]);
  it("says what was done", () => {
    expect(stateChangeSummary("tutorials", "published", { done: ["a", "b"], missing: [] }, titles)).toEqual({
      ok: true,
      message: "2 tutorials shown on the site.",
    });
    expect(stateChangeSummary("workshops", "draft", { done: ["a"], missing: [] }, titles).message).toBe("1 workshop hidden from the site.");
  });

  it("names what was missing, and is not a success", () => {
    expect(stateChangeSummary("tutorials", "published", { done: ["a"], missing: ["b", "z"] }, titles)).toEqual({
      ok: false,
      message: "1 tutorial shown on the site, but “Beta” and “z” no longer exist. Reload the page.",
    });
    expect(stateChangeSummary("tutorials", "draft", { done: [], missing: ["c"] }, titles).message).toBe(
      "Nothing was changed: “Gamma” no longer exists. Reload the page."
    );
  });
});

describe("bulkFailure", () => {
  it("tells an ended session, a missing route and the backend's own words apart", () => {
    expect(bulkFailure({ ok: false, reason: "session_expired" }, "delete")).toMatch(/session has expired/);
    expect(bulkFailure({ ok: false, reason: "not_found" }, "delete")).toMatch(/Couldn't delete/);
    expect(bulkFailure({ ok: false, reason: "error", message: "Too many." }, "delete")).toBe("Too many.");
  });
});
