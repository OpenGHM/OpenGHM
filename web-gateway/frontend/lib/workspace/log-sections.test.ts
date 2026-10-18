import { describe, expect, it } from "vitest";
import { appendText, EMPTY_LOG_TEXT } from "@/lib/workspace/log-lines";
import {
  failureReasonLines,
  foldProgress,
  lineRows,
  markReason,
  rowsToText,
  type LineRow,
  type LogRow,
} from "@/lib/workspace/log-sections";

const rows = (...lines: string[]): LineRow[] => lineRows(appendText(EMPTY_LOG_TEXT, lines.join("\n") + "\n"));

describe("lineRows", () => {
  it("numbers lines as in the file, counting the dropped ones, and classifies them", () => {
    const text = { ...appendText(EMPTY_LOG_TEXT, "fine\nan error here\n"), dropped: 10 };
    expect(lineRows(text)).toEqual([
      { kind: "line", number: 11, text: "fine", severity: null },
      { kind: "line", number: 12, text: "an error here", severity: "error" },
    ]);
  });

  it("includes the line still being written", () => {
    expect(lineRows(appendText(EMPTY_LOG_TEXT, "done\npart")).map((r) => r.text)).toEqual(["done", "part"]);
  });

  it("keeps every line as written: a counter, a banner, a module notice", () => {
    const written = [
      "  1000/32959 files",
      "== some banner ==",
      "The following modules were not unloaded:",
      "downloaded 34, skipped 32960, failed 0",
    ];
    expect(lineRows(appendText(EMPTY_LOG_TEXT, written.join("\n") + "\n")).map((r) => r.text)).toEqual(written);
  });
});

describe("rowsToText", () => {
  it("joins the rows as they are, a separator and a note too", () => {
    const out: LogRow[] = [
      { kind: "separator", text: "──── Messages ────" },
      ...rows("  1/1 files", "x"),
      { kind: "note", text: "(no output yet)" },
    ];
    expect(rowsToText(out)).toBe("──── Messages ────\n  1/1 files\nx\n(no output yet)");
  });
});

describe("the reason a failed job gives", () => {
  const excerpt = [
    "something earlier",
    "",
    "Aggregation multi-year start is outside of the run dates...",
    "  check the --run-start value",
    "--- last lines of WBM's log ---",
    "Writing Cell table...",
  ].join("\n");

  it("is the last block of the excerpt's stderr part, as the failure card quotes it", () => {
    expect([...failureReasonLines(excerpt)]).toEqual([
      "check the --run-start value",
      "Aggregation multi-year start is outside of the run dates...",
    ]);
    expect(failureReasonLines(null).size).toBe(0);
    expect(failureReasonLines("").size).toBe(0);
  });

  it("turns those lines red, keeps a warning a warning, and never changes the text", () => {
    const text = [
      "dpkg-architecture: warning: cannot determine CC system type",
      "Aggregation multi-year start is outside of the run dates...",
      "unrelated",
    ];
    const marked = markReason(rows(...text), failureReasonLines(excerpt));
    expect(marked.map((r) => r.severity)).toEqual(["warning", "error", null]);
    expect(marked.map((r) => r.text)).toEqual(text);
    const same = rows("a");
    expect(markReason(same, new Set())).toBe(same);
  });
});

describe("foldProgress", () => {
  const counters = (n: number) => Array.from({ length: n }, (_, i) => `  ${(i + 1) * 1000}/32959 files`);

  it("folds a run of counter lines into its last line, which keeps its number", () => {
    const folded = foldProgress(rows("before", ...counters(5), "after"));
    expect(folded.map((r) => r.kind)).toEqual(["line", "folded", "line", "line"]);
    const fold = folded[1];
    if (fold.kind !== "folded") throw new Error("not folded");
    expect(fold.rows.map((r) => r.number)).toEqual([2, 3, 4, 5]);
    expect(folded[2]).toMatchObject({ number: 6, text: "  5000/32959 files" });
  });

  it("leaves a short run, and lines that are not counters, alone", () => {
    const input = rows("a", ...counters(2), "b", "12/34 files and more");
    expect(foldProgress(input)).toEqual(input);
  });

  it("folds each run on its own, and names a run by its block and first line", () => {
    const input: LogRow[] = [
      { kind: "separator", text: "──── Messages ────" },
      ...rows(...counters(3), "x", ...counters(4)),
    ];
    const folded = foldProgress(input);
    expect(folded.filter((r) => r.kind === "folded").map((r) => (r.kind === "folded" ? r.key : ""))).toEqual([
      "──── Messages ────:1",
      "──── Messages ────:5",
    ]);
  });

  it("does not change what Copy takes", () => {
    const input = rows(...counters(6));
    foldProgress(input);
    expect(rowsToText(input).split("\n")).toHaveLength(6);
  });
});
