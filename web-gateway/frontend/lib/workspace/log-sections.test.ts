import { describe, expect, it } from "vitest";
import { appendText, EMPTY_LOG_TEXT } from "@/lib/workspace/log-lines";
import {
  collapseProgress,
  errorCount,
  errorKeys,
  failureReasonLines,
  fetchesDone,
  JOB_BODY_MARKER,
  lineCount,
  lineRows,
  markReason,
  nextErrorIndex,
  onlyErrorRows,
  rowsToText,
  splitStderr,
  type LineRow,
  type LogRow,
} from "@/lib/workspace/log-sections";

const rows = (...lines: string[]): LineRow[] => lineRows(appendText(EMPTY_LOG_TEXT, lines.join("\n") + "\n"));
const texts = (list: LogRow[]) => list.map((r) => (r.kind === "gap" ? `gap ${r.hidden}` : r.text));

describe("JOB_BODY_MARKER", () => {
  it("is the line the job script writes", () => {
    expect(JOB_BODY_MARKER).toBe("== openghm gateway job body ==");
  });
});

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
});

describe("splitStderr", () => {
  const preamble = ["The following modules were not unloaded:", "  1) xalt/2.10.45 (sticky)"];

  it("cuts at the marker and leaves the marker out", () => {
    const split = splitStderr(rows(...preamble, JOB_BODY_MARKER, "  1000/32959 files", "boom: failed"));
    expect(split.markerFound).toBe(true);
    expect(split.setup.map((r) => r.text)).toEqual(preamble);
    expect(split.body.map((r) => r.text)).toEqual(["  1000/32959 files", "boom: failed"]);
    // The lines keep their numbers in the file.
    expect(split.body[0].number).toBe(4);
  });

  it("calls everything the body when there is no marker: the job body never started", () => {
    const split = splitStderr(rows(...preamble, "module: command not found"));
    expect(split.markerFound).toBe(false);
    expect(split.setup).toEqual([]);
    expect(split.body.map((r) => r.text)).toEqual([...preamble, "module: command not found"]);
  });

  it("has an empty body when the marker is the last line", () => {
    const split = splitStderr(rows(...preamble, JOB_BODY_MARKER));
    expect(split.markerFound).toBe(true);
    expect(split.setup).toHaveLength(2);
    expect(split.body).toEqual([]);
  });

  it("has an empty setup when the marker is the first line", () => {
    const split = splitStderr(rows(JOB_BODY_MARKER, "x"));
    expect(split.setup).toEqual([]);
    expect(split.body.map((r) => r.text)).toEqual(["x"]);
  });

  it("cuts at the first of a repeated marker and hides the others", () => {
    const split = splitStderr(rows("a", JOB_BODY_MARKER, "b", JOB_BODY_MARKER, "c"));
    expect(split.setup.map((r) => r.text)).toEqual(["a"]);
    expect(split.body.map((r) => r.text)).toEqual(["b", "c"]);
  });

  it("finds the marker through a trailing carriage return, and not inside another line", () => {
    expect(splitStderr(rows(`${JOB_BODY_MARKER}\r`, "x")).markerFound).toBe(true);
    expect(splitStderr(rows(`note: ${JOB_BODY_MARKER}`, "x")).markerFound).toBe(false);
  });

  it("handles no text", () => {
    expect(splitStderr([])).toEqual({ setup: [], body: [], markerFound: false });
  });
});

describe("collapseProgress", () => {
  const ended = { live: false };

  it("makes a counter that reached its total one line", () => {
    const out = collapseProgress(rows("  1000/32959 files", "  2000/32959 files", " 32959/32959 files"), ended);
    expect(out).toEqual([{ kind: "summary", number: 1, lines: 3, text: "Downloaded 32959 files" }]);
  });

  it("calls a download done when stdout says it went through: the counter stops short, at every 1000", () => {
    const out = collapseProgress(rows("  31000/32959 files", "  32000/32959 files"), { live: true, fetches: 1 });
    expect(texts(out)).toEqual(["Downloaded 32959 files"]);
  });

  it("says Downloading with the counter while the job is live and the counter is last", () => {
    const out = collapseProgress(rows("boom", "  1000/32959 files", "  5000/32959 files"), { live: true });
    expect(texts(out)).toEqual(["boom", "Downloading: 5000/32959 files"]);
  });

  it("says the download stopped when the job has ended without one, or something came after the counter", () => {
    expect(texts(collapseProgress(rows("  5000/32959 files"), ended))).toEqual(["Download stopped at 5000/32959 files"]);
    expect(texts(collapseProgress(rows("  5000/32959 files", "next step"), { live: true }))).toEqual([
      "Download stopped at 5000/32959 files",
      "next step",
    ]);
  });

  it("collapses each run on its own, matching the fetches to the runs in order", () => {
    const log = rows("  1/2 files", "  2/2 files", "between", "  1000/9000 files", "  2000/9000 files");
    expect(texts(collapseProgress(log, ended))).toEqual([
      "Downloaded 2 files",
      "between",
      "Download stopped at 2000/9000 files",
    ]);
    expect(texts(collapseProgress(log, { live: false, fetches: 2 }))[2]).toBe("Downloaded 9000 files");
    expect(lineCount(collapseProgress(log, ended))).toBe(5);
  });

  it("only matches a counter that is the whole line", () => {
    const out = collapseProgress(rows("  1000/32959 files done", "x 1000/32959 files", "1000/32959"), ended);
    expect(out).toHaveLength(3);
    expect(out.every((r) => r.kind === "line")).toBe(true);
  });
});

describe("fetchesDone", () => {
  it("counts the toolkit's summaries of a fetch that went through, and not one with failures", () => {
    const out = rows(
      "downloaded 34, skipped 32960, failed 0 (488.8 MB downloaded)",
      "downloaded 2, skipped 5, failed 0 (20 KB downloaded)",
      "downloaded 2, skipped 5, failed 3 (20 KB downloaded)",
      "snapshot: /x"
    );
    expect(fetchesDone(out)).toBe(2);
  });
});

describe("onlyErrorRows", () => {
  const log = rows("a", "b", "c", "d", "ERROR one", "e", "f", "g", "h", "i", "j", "failed two", "k");

  it("keeps each error with two lines around it and counts what it left out", () => {
    expect(texts(onlyErrorRows(log))).toEqual([
      "gap 2",
      "c",
      "d",
      "ERROR one",
      "e",
      "f",
      "gap 2",
      "i",
      "j",
      "failed two",
      "k",
    ]);
  });

  it("has nothing for a log without errors", () => {
    expect(onlyErrorRows(rows("a", "b", "warning: x"))).toEqual([]);
  });

  it("counts a collapsed counter as the lines it stands for", () => {
    const folded = collapseProgress(rows("  1/2 files", "  2/2 files", "a", "b", "c", "bad failure"), { live: false });
    expect(texts(onlyErrorRows(folded, 1))).toEqual(["gap 4", "c", "bad failure"]);
  });
});

describe("errors", () => {
  const sections = [
    { id: "setup" as const, rows: rows("a") },
    { id: "stdout" as const, rows: rows("fine", "failed here") },
    { id: "wbm" as const, rows: rows("Traceback", "warning: x", "KeyError: y") },
  ];

  it("counts error lines, not warnings", () => {
    expect(errorCount(sections[2].rows)).toBe(2);
  });

  it("lists them across sections in the order shown", () => {
    expect(errorKeys(sections)).toEqual(["stdout:2", "wbm:1", "wbm:3"]);
  });

  it("steps to the first, then on, then round again", () => {
    expect(nextErrorIndex(null, 3)).toBe(0);
    expect(nextErrorIndex(0, 3)).toBe(1);
    expect(nextErrorIndex(2, 3)).toBe(0);
    expect(nextErrorIndex(null, 0)).toBe(-1);
  });
});

describe("rowsToText", () => {
  it("joins the lines, a counter as its summary, a gap as a note", () => {
    const out: LogRow[] = [{ kind: "gap", hidden: 2 }, ...collapseProgress(rows("  1/1 files", "x"), { live: false })];
    expect(rowsToText(out)).toBe("... 2 lines hidden ...\nDownloaded 1 files\nx");
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

  it("turns those lines red after the marker, and nothing before it, and keeps a warning a warning", () => {
    const text = [
      "Aggregation multi-year start is outside of the run dates...",
      JOB_BODY_MARKER,
      "dpkg-architecture: warning: cannot determine CC system type",
      "Aggregation multi-year start is outside of the run dates...",
      "unrelated",
    ];
    const marked = markReason(rows(...text), failureReasonLines(excerpt));
    expect(marked.map((r) => r.severity)).toEqual([null, null, "warning", "error", null]);
    const same = rows("a");
    expect(markReason(same, new Set())).toBe(same);
  });

  it("marks everything when there is no marker: the body never started", () => {
    expect(markReason(rows("boom"), new Set(["boom"]))[0].severity).toBe("error");
  });
});
