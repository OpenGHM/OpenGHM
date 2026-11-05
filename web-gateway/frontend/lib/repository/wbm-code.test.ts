import { describe, expect, it } from "vitest";
import { fakeDataset } from "@/lib/workspace/fixtures";
import {
  codeStateLabel,
  codeStateNote,
  hiddenSnapshotsNote,
  splitByCodeState,
  startsNewDraft,
} from "./wbm-code";
import type { CodeState } from "./types";

const STATES: CodeState[] = ["current", "legacy", "withdrawn", "unlisted", "mismatch", "unknown"];

describe("startsNewDraft", () => {
  it("is true for current code, and for unknown (an unreadable list refuses nothing), false for the rest", () => {
    expect(STATES.filter(startsNewDraft)).toEqual(["current", "unknown"]);
  });
});

describe("the chip's words", () => {
  it("has a label and a sentence for every state that shows a chip, and neither for current and unknown", () => {
    for (const state of STATES) {
      const shown = !startsNewDraft(state);
      expect(codeStateLabel(state) !== null).toBe(shown);
      expect(codeStateNote(state) !== null).toBe(shown);
    }
  });

  it("says a legacy snapshot runs as published and that no new snapshot starts from it", () => {
    expect(codeStateNote("legacy")).toBe("Legacy: runs as published; no new snapshot starts from it.");
  });

  it("gives the reason a version was withdrawn when it has one", () => {
    expect(codeStateNote("withdrawn", "wrong evaporation constant")).toBe(
      "This WBM code was withdrawn: wrong evaporation constant. Nothing is submitted on it."
    );
    expect(codeStateNote("withdrawn")).toContain("withdrawn as known to be bad");
    expect(codeStateNote("withdrawn", null)).toContain("withdrawn as known to be bad");
  });

  it("says a mismatched or unlisted code does not match or is not in the published list", () => {
    expect(codeStateNote("mismatch")).toContain("does not match");
    expect(codeStateNote("unlisted")).toContain("not in the list of published WBM code versions");
  });
});

describe("splitByCodeState", () => {
  it("keeps the order of both halves", () => {
    const items = STATES.map((codeState, i) => fakeDataset({ id: `s${i}`, codeState }));
    const { offered, hidden } = splitByCodeState(items);
    expect(offered.map((d) => d.codeState)).toEqual(["current", "unknown"]);
    expect(hidden.map((d) => d.codeState)).toEqual(["legacy", "withdrawn", "unlisted", "mismatch"]);
  });
});

describe("hiddenSnapshotsNote", () => {
  const on = (version: string, codeState: CodeState) => {
    const d = fakeDataset({ codeState });
    return { ...d, uses: { ...d.uses, modelCode: { ...d.uses.modelCode, version } } };
  };

  it("uses the singular for one", () => {
    expect(hiddenSnapshotsNote([on("22.1.1", "legacy")])).toBe(
      "1 model snapshot is not offered: it runs on older WBM code (22.1.1), which no new snapshot draft starts from."
    );
  });

  it("lists each version once, and says no longer current when any is not merely legacy", () => {
    expect(hiddenSnapshotsNote([on("22.1.1", "legacy"), on("22.1.1", "legacy"), on("21.0.0", "unlisted")])).toBe(
      "3 model snapshots are not offered: they run on no longer current WBM code (22.1.1, 21.0.0), which no new snapshot draft starts from."
    );
  });
});
