import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { JobStatus, LogStream } from "@/lib/jobs/types";
import { AllLogs } from "@/components/workspace/log-all-view";
import { INITIAL_STREAM, previewStreamState, type StreamState } from "@/lib/workspace/log-stream";
import { JOB_BODY_MARKER } from "@/lib/workspace/log-sections";
import type { LogStates } from "@/lib/workspace/use-job-logs";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }));

const PREAMBLE = [
  "The following modules were not unloaded:",
  "  (Use \"module --force purge\" to unload all):",
  "  1) xalt/2.10.45 (sticky)",
  "Currently Loaded Modules:",
  "  1) xalt/2.10.45",
];

const HEALTHY: Record<LogStream, string> = {
  stdout: "openghm 0.2.0 commit 8c3077b\ndownloaded 32959 files\n",
  wbm: "Spinup 1/12 (1991-01-01)\nSpinup 2/12 (1991-01-02)\n",
  stderr: [...PREAMBLE, JOB_BODY_MARKER, "  1000/32959 files", "  32959/32959 files", ""].join("\n"),
};

const states = (over: Partial<Record<LogStream, StreamState | string | undefined>> = {}): LogStates => {
  const pick = (s: LogStream) => {
    const v = s in over ? over[s] : HEALTHY[s];
    return typeof v === "object" ? v : previewStreamState(v);
  };
  return { wbm: pick("wbm"), stdout: pick("stdout"), stderr: pick("stderr") };
};

interface Props {
  status?: JobStatus;
  files?: "purged" | null;
  onRetry?: (s: LogStream) => void;
  onDownload?: (s: LogStream) => void;
  preview?: boolean;
  failure?: { cause: "wbm_error"; excerpt: string | null } | null;
}
const view = (
  st: LogStates,
  { status = "COMPLETED", files = null, onRetry = vi.fn(), onDownload = vi.fn(), preview = true, failure = null }: Props = {}
) => (
  <AllLogs
    states={st}
    status={status}
    files={files}
    failure={failure}
    wbmLog
    preview={preview}
    downloading={false}
    onRetry={onRetry}
    onDownload={onDownload}
  />
);

const headings = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(cleanup);

describe("AllLogs sections", () => {
  it("stacks setup, job output, WBM log and messages in that order, with line counts", () => {
    render(view(states()));
    expect(headings()).toEqual([
      "Setup messages (module loading)5 lines",
      "Job output2 lines",
      "WBM log2 lines",
      // The two counter lines show as one row, and still count as two.
      "Messages2 lines",
    ]);
  });

  it("folds the setup messages, and opens them on request", () => {
    render(view(states()));
    const toggle = screen.getByRole("button", { name: /Setup messages/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/not unloaded/)).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("The following modules were not unloaded:")).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByText(/not unloaded/)).toBeNull();
  });

  it("never shows the delimiter line, open or folded", () => {
    const { container } = render(view(states()));
    fireEvent.click(screen.getByRole("button", { name: /Setup messages/ }));
    expect(container.textContent).not.toContain(JOB_BODY_MARKER);
  });

  it("shows the download counter as one line", () => {
    render(view(states()));
    const messages = screen.getByRole("log", { name: "Messages" });
    expect(messages.textContent).toContain("Downloaded 32959 files");
    expect(messages.textContent).not.toContain("1000/32959");
    expect(within(messages).getAllByText(/Downloaded/)).toHaveLength(1);
  });

  it("calls the download done once the job's output has its summary, though the counter stops short", () => {
    const stderr = [...PREAMBLE, JOB_BODY_MARKER, "  1000/32959 files", "  32000/32959 files", ""].join("\n");
    const stdout = "openghm 0.2.0 commit 8c3077b\ndownloaded 34, skipped 32960, failed 0 (488.8 MB downloaded)\n";
    render(view(states({ stderr, stdout }), { status: "RUNNING" }));
    expect(screen.getByRole("log", { name: "Messages" }).textContent).toContain("Downloaded 32959 files");
  });

  it("says Downloading with the counter while a live job is still downloading", () => {
    const stderr = [...PREAMBLE, JOB_BODY_MARKER, "  1000/32959 files", "  5000/32959 files", ""].join("\n");
    render(view(states({ stderr, stdout: "openghm 0.2.0 commit 8c3077b\n" }), { status: "RUNNING" }));
    expect(screen.getByRole("log", { name: "Messages" }).textContent).toContain("Downloading: 5000/32959 files");
  });

  it("shows stderr with no marker as messages, with no setup section", () => {
    render(view(states({ stderr: "module: command not found\n" })));
    expect(headings()).toEqual(["Job output2 lines", "WBM log2 lines", "Messages1 line"]);
    expect(screen.getByRole("log", { name: "Messages" }).textContent).toContain("module: command not found");
  });

  it("does not turn the setup messages red", () => {
    const { container } = render(view(states()));
    fireEvent.click(screen.getByRole("button", { name: /Setup messages/ }));
    expect(container.querySelectorAll("[data-severity]")).toHaveLength(0);
    expect(screen.getByText("No errors found in the logs")).toBeTruthy();
  });

  it("keeps every line scrolling inside its own box", () => {
    render(view(states()));
    for (const log of screen.getAllByRole("log")) expect(log.className).toContain("overflow-auto");
  });
});

describe("AllLogs errors", () => {
  const OOM = {
    ...HEALTHY,
    stderr: [...PREAMBLE, JOB_BODY_MARKER, "  1000/32959 files", "slurmstepd: error: Detected 1 oom_kill event", ""].join("\n"),
  };

  it("marks error lines in red with a marker and a hidden word", () => {
    render(view(states(OOM)));
    const row = screen.getByRole("log", { name: "Messages" }).querySelector("[data-severity='error']") as HTMLElement;
    expect(row.textContent).toContain("oom_kill");
    expect(row.className).toContain("text-red-200");
    expect(row.querySelector("[data-marker]")?.textContent).toBe("!");
    expect(row.querySelector(".sr-only")?.textContent).toBe("Error: ");
  });

  it("counts them, or says there are none", () => {
    const { unmount } = render(view(states(OOM)));
    expect(screen.getByText("1 error line")).toBeTruthy();
    unmount();
    render(view(states()));
    expect(screen.getByText("No errors found in the logs")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Next error" })).toBeNull();
  });

  it("does not claim there are none while a log is still loading or could not be read", () => {
    render(view(states({ wbm: INITIAL_STREAM })));
    expect(screen.getByText("No errors found in the logs read so far")).toBeTruthy();
  });

  it("steps through the errors across sections, opens the folded setup for one in it, and goes round", () => {
    const st = states({
      stdout: "fine\nstep failed\n",
      wbm: "Traceback (most recent call last):\nValueError: Aggregation multi-year start is outside of the run dates\n",
      stderr: ["module: error: cannot load", JOB_BODY_MARKER, "ok"].join("\n"),
    });
    render(view(st));
    expect(screen.getByText("4 error lines")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "First error" }));
    // The first error is in the folded setup: it opens, and the line is current and scrolled to.
    expect(screen.getByRole("button", { name: /Setup messages/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Error 1 of 4")).toBeTruthy();
    const current = () => document.querySelector("[data-current]") as HTMLElement;
    expect(current().textContent).toContain("cannot load");
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "center" });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(current());

    const next = screen.getByRole("button", { name: "Next error" });
    fireEvent.click(next);
    expect(current().textContent).toContain("step failed");
    fireEvent.click(next);
    expect(current().textContent).toContain("Traceback");
    fireEvent.click(next);
    expect(current().textContent).toContain("ValueError");
    expect(screen.getByText("Error 4 of 4")).toBeTruthy();
    fireEvent.click(next);
    expect(current().textContent).toContain("cannot load");
    expect(screen.getByText("Error 1 of 4")).toBeTruthy();
  });

  it("starts Next error at the first when none is on show", () => {
    render(view(states({ stdout: "boom failed\n" })));
    fireEvent.click(screen.getByRole("button", { name: "Next error" }));
    expect(screen.getByText("Error 1 of 1")).toBeTruthy();
  });

  it("makes the buttons tall enough to touch on a phone", () => {
    render(view(states(OOM)));
    for (const name of ["First error", "Next error", "Show only errors"]) {
      expect(screen.getByRole("button", { name }).className).toContain("min-h-10");
    }
  });
});

describe("AllLogs: a failed job's reason", () => {
  const stderr = [...PREAMBLE, JOB_BODY_MARKER, "dpkg-architecture: warning: no CC", "Aggregation multi-year start is outside of the run dates...", ""].join("\n");
  const failure = { cause: "wbm_error" as const, excerpt: "Aggregation multi-year start is outside of the run dates..." };

  it("is red in Messages, the way the failure card quotes it", () => {
    render(view(states({ stderr }), { status: "FAILED", failure }));
    const log = screen.getByRole("log", { name: "Messages" });
    const red = log.querySelector("[data-severity='error']") as HTMLElement;
    expect(red.textContent).toContain("Aggregation multi-year start is outside of the run dates");
    expect(log.querySelector("[data-severity='warning']")?.textContent).toContain("dpkg-architecture");
    expect(screen.getByText("1 error line")).toBeTruthy();
  });

  it("is plain on a job that did not fail", () => {
    render(view(states({ stderr }), { status: "COMPLETED", failure }));
    expect(screen.getByRole("log", { name: "Messages" }).querySelector("[data-severity='error']")).toBeNull();
  });
});

describe("AllLogs: only errors", () => {
  const long = (...lines: string[]) => lines.join("\n") + "\n";
  const st = () =>
    states({
      stdout: long("l1", "l2", "l3", "l4", "l5", "boom failed", "l7", "l8", "l9", "l10", "l11"),
      wbm: long("all", "fine"),
    });

  it("keeps each error with two lines around it, says how many it left out, and can be turned off", () => {
    render(view(st()));
    const toggle = screen.getByRole("button", { name: "Show only errors" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    const out = screen.getByRole("log", { name: "Job output" });
    const text = out.textContent ?? "";
    for (const kept of ["l4", "l5", "boom failed", "l7", "l8"]) expect(text).toContain(kept);
    for (const left of ["l1", "l2", "l3", "l9", "l10", "l11"]) expect(text).not.toContain(left);
    expect(text.match(/3 lines without errors hidden/g)).toHaveLength(2);

    fireEvent.click(toggle);
    expect(screen.getByRole("log", { name: "Job output" }).textContent).toContain("l11");
  });

  it("says so in a section with no errors, and leaves the folded setup out", () => {
    render(view(st()));
    fireEvent.click(screen.getByRole("button", { name: "Show only errors" }));
    expect(screen.queryByRole("log", { name: "WBM log" })).toBeNull();
    expect(screen.getAllByText("No error lines in this section.")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Setup messages/ })).toBeNull();
  });
});

describe("AllLogs: one section at a time", () => {
  it("shows a loading state for a log not read yet, and the rest as they are", () => {
    render(view(states({ stdout: INITIAL_STREAM }), { preview: false, status: "RUNNING" }));
    expect(screen.getByLabelText("Loading Job output")).toBeTruthy();
    expect(screen.getByRole("log", { name: "WBM log" })).toBeTruthy();
    // The delayed fade-in, so a quick read shows nothing.
    expect(screen.getByLabelText("Loading Job output").className).toContain("reveal-delayed");
  });

  it("shows a failed read inside its section with Retry for that stream", () => {
    const onRetry = vi.fn();
    const failed = { ...previewStreamState("kept\n"), error: "Anvil did not answer." };
    render(view(states({ stdout: failed }), { onRetry }));
    expect(screen.getByText("Anvil did not answer.")).toBeTruthy();
    // What was read stays on show.
    expect(screen.getByRole("log", { name: "Job output" }).textContent).toContain("kept");
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalledWith("stdout");
    expect(screen.getByRole("log", { name: "WBM log" })).toBeTruthy();
  });

  it("says in one line when a log is not there yet", () => {
    render(view(states({ wbm: undefined }), { status: "RUNNING" }));
    expect(
      screen.getByText("WBM hasn't started writing its log yet. It starts after the model snapshot is fetched.")
    ).toBeTruthy();
    expect(screen.queryByRole("log", { name: "WBM log" })).toBeNull();
  });

  it("says in one line what an ended job did not write, and what is missing after the setup", () => {
    render(view(states({ stdout: "", stderr: [...PREAMBLE, JOB_BODY_MARKER].join("\n") })));
    expect(screen.getByText("This job wrote no output.")).toBeTruthy();
    expect(screen.getByText("This job wrote no messages.")).toBeTruthy();
    expect(headings()).toContain("Setup messages (module loading)5 lines");
  });

  it("offers the whole file when a long log shows only its end", () => {
    const onDownload = vi.fn();
    const st = states();
    st.wbm = { ...st.wbm, startedMidway: true, size: 3_000_000 };
    render(view(st, { onDownload }));
    fireEvent.click(screen.getByRole("button", { name: "Download it" }));
    expect(onDownload).toHaveBeenCalledWith("wbm");
  });
});

describe("AllLogs: copy", () => {
  it("copies what is on show, each section under its header", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(view(states()));
    fireEvent.click(screen.getByRole("button", { name: "Copy all logs text" }));
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toBe(
      [
        "== Job output (2 lines) ==\nopenghm 0.2.0 commit 8c3077b\ndownloaded 32959 files",
        "== WBM log (2 lines) ==\nSpinup 1/12 (1991-01-01)\nSpinup 2/12 (1991-01-02)",
        "== Messages (2 lines) ==\nDownloaded 32959 files",
      ].join("\n\n")
    );
    // The folded setup is not on show, so it is not copied.
    expect(text).not.toContain("xalt");
    vi.unstubAllGlobals();
  });
});

describe("AllLogs: before there is anything to read", () => {
  it("says logs come when SLURM starts the job, once", () => {
    render(view(states({ stdout: INITIAL_STREAM, wbm: INITIAL_STREAM, stderr: INITIAL_STREAM }), { status: "PENDING", preview: false }));
    expect(screen.getByText("Logs appear here once SLURM starts the job.")).toBeTruthy();
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });
});
