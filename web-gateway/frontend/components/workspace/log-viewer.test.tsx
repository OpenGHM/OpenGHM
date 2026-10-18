import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { JobLogChunk, JobStatus, JobStatusResponse, LogStream } from "@/lib/jobs/types";

const { fetchJobLog, pollJobStatus, toast } = vi.hoisted(() => ({
  fetchJobLog: vi.fn(),
  pollJobStatus: vi.fn(),
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock("@/lib/jobs/actions", () => ({
  pollJobStatus: (...args: unknown[]) => pollJobStatus(...args),
  cancelJob: vi.fn(),
  fetchJobLog: (...args: unknown[]) => fetchJobLog(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/workspace/x",
}));
vi.mock("sonner", () => ({ toast }));

import { LiveJobProvider } from "@/components/workspace/live-job-provider";
import { LogViewer } from "@/components/workspace/log-viewer";

const chunk = (over: Partial<JobLogChunk> = {}): { ok: true; data: JobLogChunk } => ({
  ok: true,
  data: {
    job_id: "j1",
    stream: "wbm",
    exists: true,
    data: "",
    offset: 0,
    next_offset: 0,
    size: 0,
    eof: true,
    ...over,
  },
});

function viewer(
  status: JobStatus,
  { data = {}, previewLogs }: { data?: Partial<JobStatusResponse>; previewLogs?: Partial<Record<LogStream, string>> } = {}
) {
  return (
    <LiveJobProvider jobId="j1" initialStatus={status} initialData={data} preview>
      <LogViewer previewLogs={previewLogs} />
    </LiveJobProvider>
  );
}

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchJobLog.mockReset();
  pollJobStatus.mockReset();
  toast.error.mockReset();
  toast.info.mockReset();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const box = () => screen.getByRole("log", { name: "Simulation logs" });

const polled = (status: JobStatus): { ok: true; data: JobStatusResponse } => ({
  ok: true,
  data: {
    job_id: "j1",
    sim_id: "sim-1",
    status,
    slurm_job_id: "1",
    submitted_at: null,
    started_at: null,
    completed_at: null,
    status_reason: null,
    work_dir: null,
    slurm_state: null,
    slurm_exit_code: null,
    slurm_start: null,
    slurm_end: null,
    failure: null,
    cancel_requested_at: null,
    cancel_requested_by_email: null,
    files: null,
    output: null,
    live: null,
  },
});

describe("LogViewer with fixture text", () => {
  it("is one accessible log box with a hidden line-number gutter, and no tabs", () => {
    render(viewer("RUNNING", { previewLogs: { wbm: "first\nsecond\nthird" } }));
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getAllByRole("log")).toHaveLength(1);
    const log = box();
    expect(log.getAttribute("tabindex")).toBe("0");
    // A log is polite by default; this one must not announce every line.
    expect(log.getAttribute("aria-live")).toBe("off");
    const gutter = [...log.querySelectorAll("[data-line-number]")];
    expect(gutter.map((g) => g.textContent)).toEqual(["1", "2", "3"]);
    expect(gutter.every((g) => g.closest("[aria-hidden='true']") !== null)).toBe(true);
    expect(log.innerHTML).toContain("select-none");
    expect(fetchJobLog).not.toHaveBeenCalled();
  });

  it("shows the sources in order, each after one plain separator line, every line as written", () => {
    render(
      viewer("COMPLETED", {
        previewLogs: {
          wbm: "wbm line",
          stdout: "out line\ndownloaded 1, skipped 2, failed 0 (1 KB downloaded)",
          stderr: "The following modules were not unloaded:\n  1000/32959 files\n  32000/32959 files\nmessage line",
        },
      })
    );
    const text = box().textContent ?? "";
    const at = (s: string) => text.indexOf(s);
    const order = [
      "Job output",
      "out line",
      "WBM log",
      "wbm line",
      "Messages",
      "not unloaded",
      "1000/32959 files",
      "32000/32959 files",
      "message line",
    ].map(at);
    expect(order.every((n) => n >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text).not.toContain("Setup messages");
    expect(text).not.toContain("Downloaded 32959 files");
    expect(box().querySelector("[data-dim]")).toBeNull();
  });

  it("marks an error line in red with a marker and a word for those who do not see colour", () => {
    render(viewer("FAILED", { previewLogs: { wbm: "all well\nValueError: Aggregation multi-year start is outside\nUserWarning: x" } }));
    // A line number sits in the gutter, which sits in the row.
    const rows = [...box().querySelectorAll("[data-line-number]")].map((n) => n.parentElement!.parentElement as HTMLElement);
    const [plain, error, warning] = rows;
    expect(plain.getAttribute("data-severity")).toBeNull();
    expect(error.getAttribute("data-severity")).toBe("error");
    expect(error.className).toContain("text-hero-error");
    expect(error.querySelector("[data-marker]")?.textContent).toBe("!");
    expect(error.querySelector(".sr-only")?.textContent).toBe("Error: ");
    expect(warning.getAttribute("data-severity")).toBe("warning");
    expect(warning.querySelector(".sr-only")?.textContent).toBe("Warning: ");
    expect(plain.querySelector(".sr-only")).toBeNull();
  });

  it("shows a failed job's reason in red, as the failure card quotes it", () => {
    render(
      viewer("FAILED", {
        previewLogs: { stderr: "Aggregation multi-year start is outside of the run dates...\n" },
        data: { failure: { cause: "wbm_error", phase: null, message: "x", excerpt: "Aggregation multi-year start is outside of the run dates..." } },
      })
    );
    expect(box().querySelector("[data-severity='error']")?.textContent).toContain("Aggregation multi-year");
  });

  it("says one muted line for a source that was never written", () => {
    render(viewer("COMPLETED", { previewLogs: { wbm: "a", stderr: undefined } }));
    expect(box().textContent).toContain("(no output)");
  });

  it("copies the whole box as plain text, separator lines included", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(viewer("COMPLETED", { previewLogs: { wbm: "w", stdout: "o", stderr: "m" } }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy logs text" })));
    expect(writeText).toHaveBeenCalledWith("──── Job output ────\no\n──── WBM log ────\nw\n──── Messages ────\nm");
  });

  describe("a long run of file counters", () => {
    const counters = Array.from({ length: 32 }, (_, i) => `  ${(i + 1) * 1000}/32959 files`);
    const stderr = ["before", ...counters, "downloaded 34, skipped 0, failed 0"].join("\n");

    it("folds into its last line, keeps the file's line numbers, and expands on request", () => {
      render(viewer("COMPLETED", { previewLogs: { stderr } }));
      expect(box().textContent).toContain("… 31 progress lines hidden");
      expect(box().textContent).toContain("32000/32959 files");
      expect(box().textContent).not.toContain("1000/32959 files");
      // before = 1, the last counter is line 33, the summary line 34.
      expect([...box().querySelectorAll("[data-line-number]")].map((g) => g.textContent)).toEqual(["1", "33", "34"]);

      fireEvent.click(screen.getByRole("button", { name: "Show" }));
      expect(box().textContent).toContain("1000/32959 files");
      expect(box().querySelectorAll("[data-line-number]")).toHaveLength(34);
      fireEvent.click(screen.getByRole("button", { name: "Hide" }));
      expect(box().textContent).not.toContain("1000/32959 files");
    });

    it("is still all there when copied", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      render(viewer("COMPLETED", { previewLogs: { stderr } }));
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy logs text" })));
      const copied = writeText.mock.calls[0][0] as string;
      expect(copied).toContain("  1000/32959 files\n  2000/32959 files");
      expect(copied.split("\n")).toContain("  32000/32959 files");
    });
  });

  it("waits for SLURM without a box while the job is queued", async () => {
    render(viewer("PENDING"));
    await tick(30_000);
    expect(screen.getByText("Logs appear here once SLURM starts the simulation.")).toBeTruthy();
    expect(screen.queryByRole("log")).toBeNull();
    expect(fetchJobLog).not.toHaveBeenCalled();
  });
});

describe("LogViewer reading", () => {
  const answer = (texts: Partial<Record<LogStream, string>>) => async (_id: string, s: LogStream) => {
    const data = texts[s];
    return data === undefined
      ? chunk({ stream: s, exists: false })
      : chunk({ stream: s, data, next_offset: data.length, size: data.length });
  };
  const reads = () => fetchJobLog.mock.calls.map((c) => `${c[1]}@${c[2] ?? "tail"}`);

  it("reads each log once for an ended job, one after another, and then stops", async () => {
    fetchJobLog.mockImplementation(answer({ wbm: "step 1\n", stdout: "out\n", stderr: "msg\n" }));
    render(viewer("FAILED"));
    for (let i = 0; i < 4; i++) await tick(0);
    expect(reads()).toEqual(["wbm@tail", "stdout@tail", "stderr@tail"]);
    expect(box().textContent).toContain("step 1");
    await tick(60_000);
    expect(fetchJobLog).toHaveBeenCalledTimes(3);
  });

  it("reads the streams one at a time while a job runs, and each again every 5 s in the same order", async () => {
    const size: Record<string, number> = {};
    const starts: number[] = [];
    fetchJobLog.mockImplementation(async (_id: string, s: LogStream, offset?: number) => {
      starts.push(Date.now());
      // Each answer takes 100 ms: three at once would all start in the same millisecond.
      await new Promise((r) => setTimeout(r, 100));
      const data = `${s} line\n`;
      const from = offset ?? 0;
      size[s] = from + data.length;
      return chunk({ stream: s, data, offset: from, next_offset: from + data.length, size: size[s] });
    });
    render(viewer("RUNNING"));
    await tick(0);
    expect(reads()).toEqual(["wbm@tail"]);
    await tick(100);
    expect(reads()).toEqual(["wbm@tail", "stdout@tail"]);
    await tick(100);
    expect(reads()).toEqual(["wbm@tail", "stdout@tail", "stderr@tail"]);
    await tick(4_800);
    expect(fetchJobLog).toHaveBeenCalledTimes(3);
    await tick(1_000);
    expect(reads().slice(3)).toEqual(["wbm@9", "stdout@12", "stderr@12"]);
    expect(new Set(starts).size).toBe(starts.length);
  });

  it("tails first, then appends from next_offset, completing a split line", async () => {
    fetchJobLog.mockImplementation(async (_id: string, s: LogStream, offset?: number) => {
      if (s !== "wbm") return chunk({ stream: s, exists: false });
      return offset === undefined
        ? chunk({ data: "one\ntw", next_offset: 6, size: 6 })
        : chunk({ data: "o\nthree\n", offset: 6, next_offset: 14, size: 14 });
    });
    render(viewer("RUNNING"));
    await tick(0);
    expect(box().textContent).toContain("tw");
    await tick(5_000);
    expect(fetchJobLog).toHaveBeenCalledWith("j1", "wbm", 6);
    const text = box().textContent ?? "";
    expect(text).toContain("two");
    expect(text).toContain("three");
  });

  it("reads again at once while there is more", async () => {
    fetchJobLog.mockImplementation(async (_id: string, s: LogStream, offset?: number) =>
      s !== "wbm"
        ? chunk({ stream: s, exists: false })
        : offset === undefined
          ? chunk({ data: "a\n", next_offset: 2, size: 4, eof: false })
          : chunk({ data: "b\n", offset: 2, next_offset: 4, size: 4, eof: true })
    );
    render(viewer("RUNNING"));
    for (let i = 0; i < 3; i++) await tick(0);
    expect(fetchJobLog.mock.calls.filter((c) => c[1] === "wbm")).toHaveLength(2);
    expect(box().textContent).toContain("b");
  });

  it("stops reading each stream once the job has ended", async () => {
    fetchJobLog.mockImplementation(answer({ wbm: "x\n", stdout: "y\n", stderr: "z\n" }));
    pollJobStatus.mockResolvedValueOnce(polled("RUNNING")).mockResolvedValue(polled("COMPLETED"));
    render(
      <LiveJobProvider jobId="j1" initialStatus="RUNNING">
        <LogViewer />
      </LiveJobProvider>
    );
    for (let i = 0; i < 4; i++) await tick(0);
    expect(fetchJobLog).toHaveBeenCalledTimes(3);
    await tick(5_000);
    for (let i = 0; i < 6; i++) await tick(0);
    const afterEnd = fetchJobLog.mock.calls.length;
    expect(afterEnd).toBeGreaterThanOrEqual(6);
    await tick(60_000);
    expect(fetchJobLog).toHaveBeenCalledTimes(afterEnd);
  });

  it("keeps polling the other streams when one read fails, and backs off the failing one", async () => {
    const ok = answer({ wbm: "w\n", stderr: "m\n" });
    fetchJobLog.mockImplementation(async (id: string, s: LogStream) =>
      s === "stdout" ? { ok: false, reason: "error", message: "Anvil did not answer.", status: 502 } : ok(id, s)
    );
    render(viewer("RUNNING"));
    for (let i = 0; i < 4; i++) await tick(0);
    expect(box().textContent).toContain("The Job output could not be read: Anvil did not answer.");
    const of = (s: LogStream) => fetchJobLog.mock.calls.filter((c) => c[1] === s).length;
    await tick(5_000);
    expect([of("wbm"), of("stdout"), of("stderr")]).toEqual([2, 2, 2]);
    // The failing stream waits longer each time (10 s after the second failure); the others keep their 5 s.
    await tick(9_000);
    expect([of("wbm"), of("stdout"), of("stderr")]).toEqual([3, 2, 3]);
    await tick(1_100);
    expect(of("stdout")).toBe(3);
  });

  it("shows skeleton lines until the first read answers", async () => {
    let resolve!: (v: unknown) => void;
    fetchJobLog.mockReturnValue(new Promise((r) => (resolve = r)));
    render(viewer("RUNNING"));
    const skeleton = screen.getByLabelText("Loading the log");
    // The delayed fade-in, so a quick read shows nothing.
    expect(skeleton.className).toContain("reveal-delayed");
    await act(async () => resolve(chunk({ data: "hello\n", next_offset: 6, size: 6 })));
    expect(screen.queryByLabelText("Loading the log")).toBeNull();
    expect(box().textContent).toContain("hello");
  });

  it("puts a failed read in its place with a Retry for that stream, and recovers", async () => {
    fetchJobLog.mockImplementation(async (_id: string, s: LogStream) =>
      s === "stdout" && fetchJobLog.mock.calls.filter((c) => c[1] === "stdout").length === 1
        ? { ok: false, reason: "error", message: "Anvil did not answer.", status: 502 }
        : chunk({ stream: s, data: `${s}\n`, next_offset: s.length + 1, size: s.length + 1 })
    );
    render(viewer("COMPLETED"));
    for (let i = 0; i < 4; i++) await tick(0);
    expect(fetchJobLog).toHaveBeenCalledTimes(3);
    expect(screen.getAllByRole("button", { name: /Retry/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await tick(0);
    // Only the stream that failed is read again.
    expect(fetchJobLog).toHaveBeenCalledTimes(4);
    expect(fetchJobLog).toHaveBeenLastCalledWith("j1", "stdout", undefined);
    expect(box().textContent).not.toContain("could not be read");
    expect(box().textContent).toContain("stdout");
  });

  it("says (no output yet) for a missing file while the job runs", async () => {
    fetchJobLog.mockResolvedValue(chunk({ exists: false }));
    render(viewer("RUNNING"));
    for (let i = 0; i < 4; i++) await tick(0);
    expect(box().textContent).toContain("(no output yet)");
  });

  it("explains an empty Messages after SLURM stopped the job, under its separator", async () => {
    fetchJobLog.mockImplementation(async (_id: string, s: LogStream) =>
      s === "wbm" ? chunk({ stream: s, data: "x\n", next_offset: 2, size: 2 }) : chunk({ stream: s, exists: false })
    );
    render(
      viewer("FAILED", {
        data: { failure: { cause: "out_of_memory", phase: null, message: "x", excerpt: "error: Detected 1 oom_kill event" } },
      })
    );
    for (let i = 0; i < 4; i++) await tick(0);
    expect(box().textContent).toContain(
      "Nothing was written to stderr. SLURM stopped this simulation (see the log excerpt in the failure card); the WBM log shows how far it got."
    );
  });

  it("says when it opened on the end of a long log", async () => {
    fetchJobLog.mockImplementation(async (_id: string, s: LogStream) =>
      s === "wbm"
        ? chunk({ data: "x\n", offset: 2_000_000, next_offset: 2_000_002, size: 2_000_002 })
        : chunk({ stream: s, exists: false })
    );
    render(viewer("RUNNING"));
    await tick(0);
    expect(box().textContent).toContain("(showing the end of a 1.9 MB log; Download has the whole file)");
  });

  it("reads nothing while the tab is hidden, and resumes when it is shown", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    fetchJobLog.mockResolvedValue(chunk({ data: "x\n", next_offset: 2, size: 2 }));
    render(viewer("RUNNING"));
    await tick(30_000);
    expect(fetchJobLog).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await tick(0);
    expect(fetchJobLog.mock.calls[0]).toEqual(["j1", "wbm", undefined]);
  });

  it("shows the sign-in banner on a 401, and stops reading", async () => {
    fetchJobLog.mockResolvedValue({ ok: false, reason: "session_expired" });
    render(viewer("RUNNING"));
    await tick(0);
    expect(screen.getByText("Your session has expired.")).toBeTruthy();
    await tick(30_000);
    expect(fetchJobLog).toHaveBeenCalledTimes(1);
  });

  it("starts reading when the job moves from SUBMITTED to RUNNING", async () => {
    fetchJobLog.mockResolvedValue(chunk({ exists: false }));
    pollJobStatus.mockResolvedValueOnce(polled("SUBMITTED")).mockResolvedValue(polled("RUNNING"));
    render(
      <LiveJobProvider jobId="j1" initialStatus="SUBMITTED">
        <LogViewer />
      </LiveJobProvider>
    );
    await tick(0);
    expect(fetchJobLog).not.toHaveBeenCalled();
    await tick(5_000);
    await tick(0);
    expect(fetchJobLog).toHaveBeenCalled();
  });
});

describe("LogViewer download", () => {
  it("offers each source in a menu, and downloads the one picked", async () => {
    fetchJobLog.mockImplementation(async (_id: string, s: LogStream) =>
      chunk({ stream: s, data: "x\n", next_offset: 2, size: 2 })
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("the whole log", { status: 200, headers: { "content-disposition": 'attachment; filename="sim-1-stderr.log"' } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURL = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    let saved = "";
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved = this.download;
    });

    render(viewer("COMPLETED"));
    for (let i = 0; i < 4; i++) await tick(0);
    fireEvent.keyDown(screen.getByRole("button", { name: "Download a log" }), { key: "Enter" });
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Job output", "WBM log", "Messages"]);
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Messages" })));
    expect(fetchMock).toHaveBeenCalledWith("/api/jobs/j1/logs/stderr", expect.anything());
    expect(createObjectURL).toHaveBeenCalled();
    expect(saved).toBe("sim-1-stderr.log");
    click.mockRestore();
  });

  it("shows the backend's message in a toast, and the banner on a 401", async () => {
    fetchJobLog.mockResolvedValue(chunk({ data: "x\n", next_offset: 2, size: 2 }));
    const message = "This log is 73.2 MB, above the 50 MB download limit. It is on Anvil at /scratch/x.log.";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: { code: "log_too_large", message } }), {
          status: 413,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "session_expired", message: "x" }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    render(viewer("COMPLETED"));
    for (let i = 0; i < 4; i++) await tick(0);
    const pickMessages = async () => {
      fireEvent.keyDown(screen.getByRole("button", { name: "Download a log" }), { key: "Enter" });
      await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "WBM log" })));
    };
    await pickMessages();
    expect(fetchMock).toHaveBeenCalledWith("/api/jobs/j1/logs/wbm", expect.anything());
    expect(toast.error).toHaveBeenCalledWith(message, expect.anything());
    await pickMessages();
    expect(screen.getByText("Your session has expired.")).toBeTruthy();
  });
});
