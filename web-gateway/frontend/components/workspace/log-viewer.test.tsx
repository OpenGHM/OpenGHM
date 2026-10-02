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
import { JOB_BODY_MARKER } from "@/lib/workspace/log-sections";

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

/** Radix tabs switch on mouse down. */
const pick = (name: string) => fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });

const selectedTab = () =>
  screen
    .getAllByRole("tab")
    .find((t) => t.getAttribute("aria-selected") === "true")
    ?.textContent;

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

describe("LogViewer with fixture text", () => {
  it("shows the lines with a hidden line-number gutter, in an accessible log", () => {
    render(viewer("RUNNING", { previewLogs: { wbm: "first\nsecond\nthird" } }));
    pick("WBM log");
    const log = screen.getByRole("log", { name: "WBM log" });
    expect(log.getAttribute("tabindex")).toBe("0");
    // A log is polite by default; this one must not announce every line.
    expect(log.getAttribute("aria-live")).toBe("off");
    expect(log.textContent).toContain("first");
    expect(log.textContent).toContain("third");
    const gutter = log.querySelectorAll("[data-line-number]");
    expect([...gutter].map((g) => g.textContent)).toEqual(["1", "2", "3"]);
    expect([...gutter].every((g) => g.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(log.innerHTML).toContain("select-none");
    expect(fetchJobLog).not.toHaveBeenCalled();
  });

  it("has All first, then the three sources, and opens on All whatever the job's state", () => {
    for (const status of ["RUNNING", "FAILED", "COMPLETED", "SUBMITTED"] as const) {
      const { unmount } = render(viewer(status, { previewLogs: { wbm: "a", stdout: "b", stderr: "c" } }));
      expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
        "All",
        "WBM log",
        "Job output",
        "Messages",
      ]);
      expect(screen.getByRole("tablist").getAttribute("aria-label")).toBe("Log files");
      expect(selectedTab()).toBe("All");
      unmount();
    }
  });

  it("describes each tab in a line under the tab bar", () => {
    const { container } = render(viewer("COMPLETED", { previewLogs: { wbm: "a", stdout: "b", stderr: "c" } }));
    expect(container.textContent).toContain("Shown by source, not by time");
    pick("WBM log");
    expect(container.textContent).toContain("The model's own log");
    expect(container.textContent).not.toContain("Shown by source");
    pick("Job output");
    expect(container.textContent).toContain("What the job script printed");
    pick("Messages");
    expect(container.textContent).toContain(
      "Everything the job script wrote to stderr: setup messages and download progress appear here too. It is not a list of errors."
    );
  });

  it("shows a failed job's reason in red on the Messages tab, as the failure card quotes it", () => {
    render(
      viewer("FAILED", {
        previewLogs: { stderr: `${JOB_BODY_MARKER}\nAggregation multi-year start is outside of the run dates...\n` },
        data: { failure: { cause: "wbm_error", phase: null, message: "x", excerpt: "Aggregation multi-year start is outside of the run dates..." } },
      })
    );
    pick("Messages");
    const log = screen.getByRole("log", { name: "Messages" });
    expect(log.querySelector("[data-severity='error']")?.textContent).toContain("Aggregation multi-year");
    // The marker is part of the file: the tab shows the file as it is.
    expect(log.textContent).toContain(JOB_BODY_MARKER);
  });

  it("says an ended job wrote nothing on a stream it never wrote", () => {
    render(viewer("COMPLETED", { previewLogs: { wbm: "a", stderr: undefined } }));
    pick("Messages");
    expect(screen.getByText("This job wrote no messages.")).toBeTruthy();
  });

  it("marks an error line in red with a marker and a word for those who do not see colour", () => {
    render(viewer("FAILED", { previewLogs: { wbm: "all well\nValueError: Aggregation multi-year start is outside\nUserWarning: x" } }));
    pick("WBM log");
    const log = screen.getByRole("log", { name: "WBM log" });
    const [plain, error, warning] = [...log.children] as HTMLElement[];
    expect(plain.getAttribute("data-severity")).toBeNull();
    expect(error.getAttribute("data-severity")).toBe("error");
    expect(error.className).toContain("text-red-200");
    expect(error.querySelector("[data-marker]")?.textContent).toBe("!");
    expect(error.querySelector(".sr-only")?.textContent).toBe("Error: ");
    expect(warning.getAttribute("data-severity")).toBe("warning");
    expect(warning.querySelector(".sr-only")?.textContent).toBe("Warning: ");
    expect(plain.querySelector(".sr-only")).toBeNull();
  });
});

describe("LogViewer on an ended job", () => {
  const stream = (c: unknown[]) => c[1];
  const oom = {
    cause: "out_of_memory",
    phase: null,
    message: "Ran out of memory",
    excerpt: "error: Detected 1 oom_kill event",
  } as const;
  const answer = (texts: Partial<Record<LogStream, string>>) => async (_id: string, s: LogStream) => {
    const data = texts[s];
    return data === undefined
      ? chunk({ stream: s, exists: false })
      : chunk({ stream: s, data, next_offset: data.length, size: data.length });
  };

  it("opens on All, reads each log once, one after another, and then stops", async () => {
    const order: string[] = [];
    fetchJobLog.mockImplementation(async (id: string, s: LogStream) => {
      order.push(s);
      return answer({ wbm: "step 1\n", stdout: "out\n", stderr: "msg\n" })(id, s);
    });
    render(viewer("FAILED", { data: { failure: oom } }));
    await tick(0);
    await tick(0);
    await tick(0);
    expect(selectedTab()).toBe("All");
    expect(order).toEqual(["wbm", "stdout", "stderr"]);
    expect(screen.getAllByRole("log").map((l) => l.getAttribute("aria-label"))).toEqual([
      "Job output",
      "WBM log",
      "Messages",
    ]);
    await tick(60_000);
    expect(fetchJobLog).toHaveBeenCalledTimes(3);
  });

  it("opens each source's own tab with just that log, and reads only that stream from then on", async () => {
    fetchJobLog.mockImplementation(answer({ wbm: "step 1\n", stdout: "out\n", stderr: "msg\n" }));
    render(viewer("FAILED", { data: { failure: oom } }));
    await tick(0);
    await tick(0);
    await tick(0);
    fetchJobLog.mockClear();
    pick("Job output");
    await tick(0);
    expect(screen.getByRole("log").textContent).toContain("out");
    expect(fetchJobLog.mock.calls.map(stream)).toEqual(["stdout"]);
  });

  it("shows a log that failed to load as that section's error, and the others as they are", async () => {
    fetchJobLog.mockImplementation(async (id: string, s: LogStream) =>
      s === "stdout"
        ? { ok: false, reason: "error", message: "Anvil did not answer.", status: 502 }
        : answer({ wbm: "step 1\n", stderr: "msg\n" })(id, s)
    );
    render(viewer("FAILED", { data: { failure: oom } }));
    for (let i = 0; i < 4; i++) await tick(0);
    expect(screen.getByText("Anvil did not answer.")).toBeTruthy();
    expect(screen.getByRole("log", { name: "WBM log" }).textContent).toContain("step 1");
    expect(screen.getByRole("log", { name: "Messages" }).textContent).toContain("msg");
    expect(screen.getAllByRole("button", { name: /Retry/ })).toHaveLength(1);
  });

  it("says Messages is empty in the SLURM-stopped words when nothing has text", async () => {
    fetchJobLog.mockResolvedValue(chunk({ exists: false }));
    render(viewer("FAILED", { data: { failure: oom } }));
    for (let i = 0; i < 4; i++) await tick(0);
    expect(
      screen.getByText("Nothing was written to stderr. SLURM stopped this job (see the log excerpt in the failure card).")
    ).toBeTruthy();
  });

  it("says the same on the Messages tab, with the pointer to the WBM log when it has one", async () => {
    fetchJobLog.mockImplementation(async (_id: string, s: LogStream) =>
      chunk({ stream: s, exists: s === "wbm", data: s === "wbm" ? "x\n" : "", next_offset: s === "wbm" ? 2 : 0 })
    );
    render(viewer("FAILED", { data: { failure: oom } }));
    await tick(0);
    pick("Messages");
    await tick(0);
    expect(selectedTab()).toBe("Messages");
    expect(
      screen.getByText(
        "Nothing was written to stderr. SLURM stopped this job (see the log excerpt in the failure card); the WBM log shows how far it got."
      )
    ).toBeTruthy();
  });

  it("says a timeout the same way, and an ordinary failure as before", async () => {
    fetchJobLog.mockResolvedValue(chunk({ exists: false }));
    const { unmount } = render(
      viewer("FAILED", { data: { failure: { cause: "timeout", phase: null, message: "x", excerpt: null } } })
    );
    for (let i = 0; i < 4; i++) await tick(0);
    pick("Messages");
    await tick(0);
    // No WBM log was found, so it does not send the reader there.
    expect(screen.getByText("Nothing was written to stderr. SLURM stopped this job.")).toBeTruthy();
    unmount();

    render(viewer("FAILED", { data: { failure: { cause: "wbm_error", phase: null, message: "x", excerpt: null } } }));
    for (let i = 0; i < 4; i++) await tick(0);
    pick("Messages");
    await tick(0);
    expect(screen.getByText("This job wrote no messages.")).toBeTruthy();
  });
});

describe("LogViewer empty states", () => {
  it("waits for SLURM without reading anything while queued", async () => {
    render(viewer("PENDING"));
    await tick(30_000);
    expect(screen.getByText("Logs appear here once SLURM starts the job.")).toBeTruthy();
    expect(fetchJobLog).not.toHaveBeenCalled();
    pick("WBM log");
    await tick(30_000);
    expect(screen.getByText("Logs appear here once SLURM starts the job.")).toBeTruthy();
    expect(fetchJobLog).not.toHaveBeenCalled();
  });

  it("says WBM has not started its log while running with no file", async () => {
    fetchJobLog.mockResolvedValue(chunk({ exists: false }));
    render(viewer("RUNNING"));
    pick("WBM log");
    await tick(0);
    expect(
      screen.getByText("WBM hasn't started writing its log yet. It starts after the model snapshot is fetched.")
    ).toBeTruthy();
  });

  it("says nothing written yet for Job output while running", async () => {
    fetchJobLog.mockResolvedValue(chunk({ exists: false, stream: "stdout" }));
    render(viewer("RUNNING"));
    await tick(0);
    pick("Job output");
    await tick(0);
    expect(screen.getByText("Nothing written yet.")).toBeTruthy();
  });

  it("says Anvil purged the files once, on All and on a source", async () => {
    fetchJobLog.mockResolvedValue(chunk({ exists: false }));
    render(viewer("COMPLETED", { data: { files: "purged" } }));
    for (let i = 0; i < 4; i++) await tick(0);
    expect(screen.getAllByText("Anvil purged this job's files after 30 days untouched.")).toHaveLength(1);
    pick("WBM log");
    await tick(0);
    expect(screen.getByText("Anvil purged this job's files after 30 days untouched.")).toBeTruthy();
  });

  it("shows skeleton lines until the first read answers", async () => {
    let resolve!: (v: unknown) => void;
    fetchJobLog.mockReturnValue(new Promise((r) => (resolve = r)));
    render(viewer("RUNNING"));
    pick("WBM log");
    expect(screen.getByLabelText("Loading the log")).toBeTruthy();
    await act(async () => resolve(chunk({ data: "hello\n", next_offset: 6, size: 6 })));
    expect(screen.queryByLabelText("Loading the log")).toBeNull();
    expect(screen.getByRole("log").textContent).toContain("hello");
  });

  it("shows an inline error with Retry, and recovers", async () => {
    fetchJobLog.mockResolvedValueOnce({ ok: false, reason: "error", message: "Anvil did not answer.", status: 502 });
    fetchJobLog.mockResolvedValue(chunk({ data: "ok\n", next_offset: 3, size: 3 }));
    render(viewer("COMPLETED"));
    pick("WBM log");
    await tick(0);
    expect(screen.getByText("Anvil did not answer.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await tick(0);
    expect(screen.queryByText("Anvil did not answer.")).toBeNull();
    expect(screen.getByRole("log").textContent).toContain("ok");
  });

  it("retries only the section that failed, in the All view", async () => {
    fetchJobLog.mockImplementation(async (_id: string, s: LogStream) =>
      s === "stdout" && fetchJobLog.mock.calls.filter((c) => c[1] === "stdout").length === 1
        ? { ok: false, reason: "error", message: "Anvil did not answer.", status: 502 }
        : chunk({ stream: s, data: `${s}\n`, next_offset: s.length + 1, size: s.length + 1 })
    );
    render(viewer("COMPLETED"));
    for (let i = 0; i < 4; i++) await tick(0);
    expect(fetchJobLog).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await tick(0);
    expect(fetchJobLog).toHaveBeenCalledTimes(4);
    expect(fetchJobLog).toHaveBeenLastCalledWith("j1", "stdout", undefined);
    expect(screen.queryByText("Anvil did not answer.")).toBeNull();
    expect(screen.getByRole("log", { name: "Job output" }).textContent).toContain("stdout");
  });

  it("shows the sign-in banner on a 401", async () => {
    fetchJobLog.mockResolvedValue({ ok: false, reason: "session_expired" });
    render(viewer("RUNNING"));
    await tick(0);
    expect(screen.getByText("Your session has expired.")).toBeTruthy();
    await tick(30_000);
    expect(fetchJobLog).toHaveBeenCalledTimes(1);
  });
});

describe("LogViewer reading one source", () => {
  it("tails first, then appends from next_offset, completing a split line", async () => {
    fetchJobLog
      .mockResolvedValueOnce(chunk({ data: "one\ntw", next_offset: 6, size: 6 }))
      .mockResolvedValue(chunk({ data: "o\nthree\n", offset: 6, next_offset: 14, size: 14 }));
    render(viewer("RUNNING"));
    pick("WBM log");
    await tick(0);
    expect(fetchJobLog).toHaveBeenLastCalledWith("j1", "wbm", undefined);
    expect(screen.getByRole("log").textContent).toContain("tw");

    await tick(4_999);
    expect(fetchJobLog).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(fetchJobLog).toHaveBeenCalledTimes(2);
    expect(fetchJobLog).toHaveBeenLastCalledWith("j1", "wbm", 6);
    const text = screen.getByRole("log").textContent ?? "";
    expect(text).toContain("two");
    expect(text).toContain("three");
  });

  it("reads again at once while there is more, and waits 5 s once caught up", async () => {
    fetchJobLog
      .mockResolvedValueOnce(chunk({ data: "a\n", next_offset: 2, size: 10, eof: false }))
      .mockResolvedValueOnce(chunk({ data: "b\n", offset: 2, next_offset: 4, size: 4, eof: true }))
      .mockResolvedValue(chunk({ offset: 4, next_offset: 4, size: 4, eof: true }));
    render(viewer("RUNNING"));
    pick("WBM log");
    await tick(0);
    await tick(0);
    expect(fetchJobLog).toHaveBeenCalledTimes(2);
    await tick(4_000);
    expect(fetchJobLog).toHaveBeenCalledTimes(2);
    await tick(1_000);
    expect(fetchJobLog).toHaveBeenCalledTimes(3);
  });

  it("says when it opened on the end of a long log", async () => {
    fetchJobLog.mockResolvedValue(chunk({ data: "x\n", offset: 2_000_000, next_offset: 2_000_002, size: 2_000_002 }));
    const { container } = render(viewer("RUNNING"));
    pick("WBM log");
    await tick(0);
    expect(container.textContent).toContain("Showing the end of a 1.9 MB log.");
    expect(container.textContent).toContain("for the whole file.");
  });

  it("reads only the stream on show, and the other when it is selected", async () => {
    fetchJobLog.mockResolvedValue(chunk({ data: "x\n", next_offset: 2, size: 2 }));
    render(viewer("RUNNING"));
    pick("WBM log");
    await tick(0);
    await tick(10_000);
    expect(new Set(fetchJobLog.mock.calls.map((c) => c[1]))).toEqual(new Set(["wbm"]));
    pick("Messages");
    await tick(0);
    expect(fetchJobLog).toHaveBeenLastCalledWith("j1", "stderr", undefined);
  });

  it("reads to the end once for an ended job, and then stops", async () => {
    fetchJobLog.mockResolvedValue(chunk({ data: "done\n", next_offset: 5, size: 5 }));
    render(viewer("COMPLETED"));
    pick("WBM log");
    await tick(0);
    await tick(60_000);
    expect(fetchJobLog).toHaveBeenCalledTimes(1);
  });

  it("reads nothing while the tab is hidden", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    fetchJobLog.mockResolvedValue(chunk({ data: "x\n", next_offset: 2, size: 2 }));
    render(viewer("RUNNING"));
    pick("WBM log");
    await tick(30_000);
    expect(fetchJobLog).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await tick(0);
    expect(fetchJobLog).toHaveBeenCalledTimes(1);
  });
});

describe("LogViewer reading all three", () => {
  const reads = () => fetchJobLog.mock.calls.map((c) => `${c[1]}@${c[2] ?? "tail"}`);
  const grow = () => {
    const size: Record<string, number> = { wbm: 0, stdout: 0, stderr: 0 };
    return async (_id: string, s: LogStream, offset?: number) => {
      const data = `${s} line\n`;
      const from = offset ?? 0;
      size[s] = from + data.length;
      return chunk({ stream: s, data, offset: from, next_offset: from + data.length, size: size[s] });
    };
  };

  it("reads the streams one after another, then each again every 5 s, in the same order", async () => {
    // Each answer takes 100 ms: three at once would all start in the same millisecond.
    const slow = grow();
    const starts: number[] = [];
    fetchJobLog.mockImplementation(async (id: string, s: LogStream, offset?: number) => {
      starts.push(Date.now());
      await new Promise((r) => setTimeout(r, 100));
      return slow(id, s, offset);
    });
    render(viewer("RUNNING"));
    await tick(0);
    expect(reads()).toEqual(["wbm@tail"]);
    await tick(100);
    expect(reads()).toEqual(["wbm@tail", "stdout@tail"]);
    await tick(100);
    expect(reads()).toEqual(["wbm@tail", "stdout@tail", "stderr@tail"]);
    await tick(100);
    // Caught up: nothing for 5 s after each stream's own last read.
    await tick(4_500);
    expect(fetchJobLog).toHaveBeenCalledTimes(3);
    await tick(1_000);
    expect(reads().slice(3)).toEqual(["wbm@9", "stdout@12", "stderr@12"]);
    // Never two reads at the same moment.
    expect(new Set(starts).size).toBe(starts.length);
  });

  it("stops reading each stream once the job has ended", async () => {
    fetchJobLog.mockImplementation(grow());
    pollJobStatus.mockResolvedValueOnce(polled("RUNNING")).mockResolvedValue(polled("COMPLETED"));
    render(
      <LiveJobProvider jobId="j1" initialStatus="RUNNING">
        <LogViewer />
      </LiveJobProvider>
    );
    for (let i = 0; i < 4; i++) await tick(0);
    expect(fetchJobLog).toHaveBeenCalledTimes(3);
    await tick(5_000);
    // The status turned COMPLETED: one last read of each, then no more.
    for (let i = 0; i < 6; i++) await tick(0);
    const afterEnd = fetchJobLog.mock.calls.length;
    expect(afterEnd).toBeGreaterThanOrEqual(6);
    await tick(60_000);
    expect(fetchJobLog).toHaveBeenCalledTimes(afterEnd);
  });

  it("keeps polling the other streams when one read fails, and backs off the failing one", async () => {
    const ok = grow();
    fetchJobLog.mockImplementation(async (id: string, s: LogStream, offset?: number) =>
      s === "stdout" ? { ok: false, reason: "error", message: "Anvil did not answer.", status: 502 } : ok(id, s, offset)
    );
    render(viewer("RUNNING"));
    for (let i = 0; i < 4; i++) await tick(0);
    expect(screen.getByText("Anvil did not answer.")).toBeTruthy();
    expect(screen.getByRole("log", { name: "WBM log" })).toBeTruthy();
    const of = (s: LogStream) => fetchJobLog.mock.calls.filter((c) => c[1] === s).length;
    await tick(5_000);
    expect([of("wbm"), of("stdout"), of("stderr")]).toEqual([2, 2, 2]);
    // The failing stream waits longer each time (10 s after the second failure); the others keep their 5 s.
    await tick(9_000);
    expect([of("wbm"), of("stdout"), of("stderr")]).toEqual([3, 2, 3]);
    await tick(1_100);
    expect(of("stdout")).toBe(3);
  });
});

describe("LogViewer download", () => {
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

    render(viewer("RUNNING"));
    pick("WBM log");
    await tick(0);
    const button = screen.getByRole("button", { name: "Download wbm log" });
    await act(async () => fireEvent.click(button));
    expect(fetchMock).toHaveBeenCalledWith("/api/jobs/j1/logs/wbm", expect.anything());
    expect(toast.error).toHaveBeenCalledWith(message, expect.anything());

    await act(async () => fireEvent.click(button));
    expect(screen.getByText("Your session has expired.")).toBeTruthy();
  });

  it("saves the body under the server's file name", async () => {
    fetchJobLog.mockResolvedValue(chunk({ data: "x\n", next_offset: 2, size: 2 }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("the whole log", {
          status: 200,
          headers: { "content-disposition": 'attachment; filename="sim-1-wbm.log"' },
        })
      )
    );
    const createObjectURL = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    let saved = "";
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved = this.download;
    });

    render(viewer("RUNNING"));
    pick("WBM log");
    await tick(0);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Download wbm log" })));
    expect(createObjectURL).toHaveBeenCalled();
    expect(saved).toBe("sim-1-wbm.log");
    click.mockRestore();
  });

  it("offers each source in a menu on All, and downloads the one picked", async () => {
    fetchJobLog.mockImplementation(async (_id: string, s: LogStream) =>
      chunk({ stream: s, data: "x\n", next_offset: 2, size: 2 })
    );
    const fetchMock = vi.fn().mockResolvedValue(new Response("log", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(viewer("COMPLETED"));
    for (let i = 0; i < 4; i++) await tick(0);
    // The per-source buttons belong to the other tabs.
    expect(screen.queryByRole("button", { name: "Download wbm log" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "Download a log" }), { key: "Enter" });
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Job output", "WBM log", "Messages"]);
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: "Messages" })));
    expect(fetchMock).toHaveBeenCalledWith("/api/jobs/j1/logs/stderr", expect.anything());
    click.mockRestore();
  });
});

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

describe("LogViewer default tab", () => {
  const live = (status: JobStatus) => (
    <LiveJobProvider jobId="j1" initialStatus={status}>
      <LogViewer />
    </LiveJobProvider>
  );

  it("stays on All while the job moves from SUBMITTED to RUNNING", async () => {
    fetchJobLog.mockResolvedValue(chunk({ exists: false }));
    pollJobStatus.mockResolvedValueOnce(polled("SUBMITTED")).mockResolvedValue(polled("RUNNING"));
    render(live("SUBMITTED"));
    await tick(0);
    expect(selectedTab()).toBe("All");
    expect(fetchJobLog).not.toHaveBeenCalled();
    await tick(5_000);
    expect(selectedTab()).toBe("All");
    // The job has started: the logs are read now.
    await tick(0);
    expect(fetchJobLog).toHaveBeenCalled();
  });

  it("leaves the tab the person picked when the status changes", async () => {
    fetchJobLog.mockResolvedValue(chunk({ exists: false }));
    pollJobStatus.mockResolvedValueOnce(polled("SUBMITTED")).mockResolvedValue(polled("RUNNING"));
    render(live("SUBMITTED"));
    await tick(0);
    pick("Messages");
    expect(selectedTab()).toBe("Messages");
    await tick(5_000);
    expect(selectedTab()).toBe("Messages");
  });
});
