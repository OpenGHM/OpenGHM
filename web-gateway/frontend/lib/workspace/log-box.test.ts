import { describe, expect, it } from "vitest";
import type { FailureCause, JobStatus, LogStream } from "@/lib/jobs/types";
import { buildLogBox, LOG_SOURCES, sourceTitle, type LogBox } from "@/lib/workspace/log-box";
import type { LogRow } from "@/lib/workspace/log-sections";
import { INITIAL_STREAM, previewStreamState, type StreamState } from "@/lib/workspace/log-stream";

const PREAMBLE = [
  "The following modules were not unloaded:",
  "  1) xalt/2.10.45 (sticky)",
  "Currently Loaded Modules:",
  "  1) xalt/2.10.45",
];

const HEALTHY: Record<LogStream, string> = {
  stdout: "openghm 0.2.0 commit 8c3077b\ndownloaded 34, skipped 32960, failed 0 (488.8 MB downloaded)\n",
  wbm: "Spinup 1/12 (1991-01-01)\nSpinup 2/12 (1991-01-02)\n",
  stderr: [...PREAMBLE, "  1000/32959 files", "  32000/32959 files", ""].join("\n"),
};

type Over = Partial<Record<LogStream, StreamState | string | undefined>>;
const states = (over: Over = {}): Record<LogStream, StreamState> => {
  const pick = (s: LogStream) => {
    const v = s in over ? over[s] : HEALTHY[s];
    return typeof v === "object" ? v : previewStreamState(v);
  };
  return { wbm: pick("wbm"), stdout: pick("stdout"), stderr: pick("stderr") };
};

interface Opts {
  status?: JobStatus;
  files?: "purged" | null;
  failure?: { cause: FailureCause; excerpt: string | null } | null;
}
const build = (over: Over = {}, { status = "COMPLETED", files = null, failure = null }: Opts = {}): LogBox =>
  buildLogBox({ states: states(over), status, files, failure });
const rowsOf = (box: LogBox): LogRow[] => {
  if (box.kind !== "rows") throw new Error(`expected rows, got ${box.kind}`);
  return box.rows;
};
const texts = (box: LogBox) => rowsOf(box).map((r) => r.text);

describe("LOG_SOURCES", () => {
  it("names the sources as the download menu lists them", () => {
    expect(LOG_SOURCES.map((s) => [s.stream, s.label])).toEqual([
      ["stdout", "Job output"],
      ["wbm", "WBM log"],
      ["stderr", "Messages"],
    ]);
  });
});

describe("sourceTitle", () => {
  it("is the source's name, with its job for stdout and stderr only (ADR 0037)", () => {
    expect(sourceTitle("stdout")).toBe("Job output");
    expect(sourceTitle("stdout", 2)).toBe("Job output (job 2)");
    expect(sourceTitle("stderr", 1)).toBe("Messages (job 1)");
    // WBM's log is one file across jobs.
    expect(sourceTitle("wbm", 2)).toBe("WBM log");
  });
});

describe("buildLogBox", () => {
  it("lays the sources end to end, each after a separator, every line as written", () => {
    expect(texts(build())).toEqual([
      "──── Job output ────",
      "openghm 0.2.0 commit 8c3077b",
      "downloaded 34, skipped 32960, failed 0 (488.8 MB downloaded)",
      "──── WBM log ────",
      "Spinup 1/12 (1991-01-01)",
      "Spinup 2/12 (1991-01-02)",
      "──── Messages ────",
      ...PREAMBLE,
      "  1000/32959 files",
      "  32000/32959 files",
    ]);
  });

  it("rewrites nothing: no setup block, no hidden marker, no counter summary, no dimmed rows", () => {
    const rows = rowsOf(build({ stderr: "== openghm gateway job body ==\n  5000/32959 files\n" }));
    expect(rows.map((r) => r.kind)).toEqual(["separator", "line", "line", "separator", "line", "line", "separator", "line", "line"]);
    expect(texts(build({ stderr: "== openghm gateway job body ==\n  5000/32959 files\n" })).slice(-2)).toEqual([
      "== openghm gateway job body ==",
      "  5000/32959 files",
    ]);
    expect(rows.some((r) => "dim" in r)).toBe(false);
  });

  it("numbers each file's own lines, from 1", () => {
    const numbers = () =>
      rowsOf(build())
        .filter((r) => r.kind === "line")
        .map((r) => (r.kind === "line" ? r.number : 0));
    expect(numbers()).toEqual([1, 2, 1, 2, 1, 2, 3, 4, 5, 6]);
  });

  it("marks error and warning lines in every source", () => {
    const out = rowsOf(
      build({
        stdout: "outcome: fail\n",
        wbm: "ValueError: boom\nUserWarning: x\n",
        stderr: "slurmstepd: error: Detected 1 oom_kill event\n",
      })
    ).filter((r) => r.kind === "line");
    expect(out.map((r) => r.kind === "line" && r.severity)).toEqual(["error", "error", "warning", "error"]);
  });

  it("marks a failed job's reason, as the failure card quotes it", () => {
    const stderr = "Aggregation multi-year start is outside of the run dates...\n";
    const failure = { cause: "wbm_error" as const, excerpt: "Aggregation multi-year start is outside of the run dates..." };
    const line = (box: LogBox) => rowsOf(box).find((r) => r.kind === "line" && r.text.startsWith("Aggregation"));
    expect(line(build({ stderr }, { status: "FAILED", failure }))).toMatchObject({ severity: "error" });
    expect(line(build({ stderr }, { status: "COMPLETED", failure }))).toMatchObject({ severity: null });
  });
});

describe("a source with nothing to show", () => {
  it("says (no output yet) for a missing or empty file while the job runs, (no output) once it ended", () => {
    const missing = { ...INITIAL_STREAM, loaded: true };
    const live = texts(build({ wbm: missing, stdout: "" }, { status: "RUNNING" }));
    expect(live.filter((t) => t === "(no output yet)")).toHaveLength(2);
    const ended = texts(build({ wbm: missing, stdout: "" }));
    expect(ended.filter((t) => t === "(no output)")).toHaveLength(2);
  });

  it("says (loading…) in the place of a stream not read yet while another has answered", () => {
    const out = texts(build({ wbm: INITIAL_STREAM }, { status: "RUNNING" }));
    expect(out[out.indexOf("──── WBM log ────") + 1]).toBe("(loading…)");
  });

  it("puts a failed read in its own place, with Retry for that stream, and keeps the lines read", () => {
    const failed = { ...previewStreamState("kept\n"), error: "Anvil did not answer." };
    const rows = rowsOf(build({ wbm: failed }));
    const at = rows.findIndex((r) => r.text === "──── WBM log ────");
    expect(rows[at + 1]).toMatchObject({ kind: "line", text: "kept" });
    expect(rows[at + 2]).toEqual({
      kind: "note",
      text: "The WBM log could not be read: Anvil did not answer.",
      retry: "wbm",
    });
    expect(rows.filter((r) => r.kind === "note" && r.retry)).toHaveLength(1);
  });

  it("says one muted line when a read failed and nothing was read", () => {
    const failed = { ...INITIAL_STREAM, loaded: true, error: "Couldn't reach the gateway." };
    const rows = rowsOf(build({ stdout: failed }));
    const at = rows.findIndex((r) => r.text === "──── Job output ────");
    expect(rows[at + 1]).toMatchObject({ kind: "note", retry: "stdout" });
    expect(rows[at + 2]).toMatchObject({ kind: "separator" });
  });

  it("says when only the end of a long log is shown", () => {
    const st = states();
    st.wbm = { ...st.wbm, startedMidway: true, size: 3_000_000 };
    const out = buildLogBox({ states: st, status: "COMPLETED", files: null, failure: null });
    expect(texts(out)).toContain("(showing the end of a 2.9 MB log; Download has the whole file)");
  });
});

describe("the box before there is anything", () => {
  const blank = { wbm: INITIAL_STREAM, stdout: INITIAL_STREAM, stderr: INITIAL_STREAM };

  it("is loading until a stream has answered", () => {
    expect(buildLogBox({ states: blank, status: "RUNNING", files: null, failure: null })).toEqual({ kind: "loading" });
  });

  it("names the job in the separators of stdout and stderr, but not of the WBM log", () => {
    const rows = rowsOf(buildLogBox({ states: states(), status: "COMPLETED", files: null, failure: null, job: 2 }));
    expect(rows.filter((r) => r.kind === "separator").map((r) => r.text)).toEqual([
      "──── Job output (job 2) ────",
      "──── WBM log ────",
      "──── Messages (job 2) ────",
    ]);
  });

  it("shows the logs of an earlier job while the next one is queued", () => {
    const box = buildLogBox({ states: states(), status: "SUBMITTED", files: null, failure: null, job: 1, earlierJobs: true });
    expect(box.kind).toBe("rows");
  });

  it("waits for SLURM while the job is queued", () => {
    expect(buildLogBox({ states: blank, status: "PENDING", files: null, failure: null })).toEqual({
      kind: "empty",
      message: "Logs appear here once SLURM starts the simulation.",
    });
  });

  it("says once that Anvil purged the files", () => {
    const gone = { ...INITIAL_STREAM, loaded: true };
    expect(buildLogBox({ states: { wbm: gone, stdout: gone, stderr: gone }, status: "COMPLETED", files: "purged", failure: null })).toEqual({
      kind: "empty",
      message: "Anvil purged this simulation's files after 30 days untouched.",
    });
  });
});

describe("an empty Messages after SLURM stopped the job", () => {
  const oom = { cause: "out_of_memory" as const, excerpt: "error: Detected 1 oom_kill event" };
  const messagesNote = (box: LogBox) => {
    const out = texts(box);
    return out[out.indexOf("──── Messages ────") + 1];
  };

  it("explains itself in one line under the Messages separator", () => {
    expect(messagesNote(build({ stderr: "" }, { status: "FAILED", failure: oom }))).toBe(
      "Nothing was written to stderr. SLURM stopped this simulation (see the log excerpt in the failure card); the WBM log shows how far it got."
    );
  });

  it("does not point to a WBM log that is missing", () => {
    expect(messagesNote(build({ stderr: "", wbm: undefined }, { status: "FAILED", failure: oom }))).toBe(
      "Nothing was written to stderr. SLURM stopped this simulation (see the log excerpt in the failure card)."
    );
  });

  it("leaves an ordinary failure at (no output), and says nothing when there is text", () => {
    const wbmError = { cause: "wbm_error" as const, excerpt: null };
    expect(messagesNote(build({ stderr: "" }, { status: "FAILED", failure: wbmError }))).toBe("(no output)");
    expect(messagesNote(build({ stderr: "boom\n" }, { status: "FAILED", failure: oom }))).toBe("boom");
  });
});
