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
    const log = screen.getByRole("log", { name: "WBM log" });
    expect(log.getAttribute("tabindex")).toBe("0");
    // A log is polite by default; this one must not announce every line.
    expect(log.getAttribute("aria-live")).toBe("off");
    expect(log.textContent).toContain("first");
    expect(log.textContent).toContain("third");
    const gutter = log.querySelectorAll('[aria-hidden="true"]');
    expect([...gutter].map((g) => g.textContent)).toEqual(["1", "2", "3"]);
    expect(log.innerHTML).toContain("select-none");
    expect(fetchJobLog).not.toHaveBeenCalled();
  });

  it("has three tabs and opens the one the job calls for", () => {
    const { unmount } = render(viewer("RUNNING", { previewLogs: {} }));
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["WBM log", "Output", "Errors"]);
    expect(screen.getByRole("tablist").getAttribute("aria-label")).toBe("Log files");
    expect(selectedTab()).toBe("WBM log");
    unmount();

    // Nothing in any log: Errors is all that is left.
    render(viewer("FAILED", { previewLogs: {} }));
    expect(selectedTab()).toBe("Errors");
  });

  it.each<JobStatus>(["FAILED", "CANCELLED", "COMPLETED"])(
    "opens an ended %s job on the WBM log when it has one, whatever the cause",
    (status) => {
      render(
        viewer(status, {
          previewLogs: { wbm: "wbm line", stdout: "out line", stderr: "err line" },
          data: { failure: { cause: "fetch_failed", phase: null, message: "x", excerpt: null } },
        })
      );
      expect(selectedTab()).toBe("WBM log");
    }
  );

  it.each<JobStatus>(["FAILED", "CANCELLED", "COMPLETED"])(
    "opens an ended %s job on Output when it has no WBM log",
    (status) => {
      render(viewer(status, { previewLogs: { stdout: "out line", stderr: "err line" } }));
      expect(selectedTab()).toBe("Output");
    }
  );

  it("opens on Errors only when the WBM log and Output are both empty", () => {
    render(viewer("FAILED", { previewLogs: { stdout: "", stderr: "err line" } }));
    expect(selectedTab()).toBe("Errors");
  });

  it("says an ended job wrote nothing on a stream it never wrote", () => {
    render(viewer("COMPLETED", { previewLogs: { wbm: "a", stderr: undefined } }));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Errors" }), { button: 0 });
    expect(screen.getByText("This job wrote no error output.")).toBeTruthy();
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

  it("opens on the WBM log and reads only that", async () => {
    fetchJobLog.mockResolvedValue(chunk({ data: "step 1\n", next_offset: 7, size: 7 }));
    render(viewer("FAILED", { data: { failure: oom } }));
    await tick(0);
    expect(selectedTab()).toBe("WBM log");
    expect(screen.getByRole("log").textContent).toContain("step 1");
    expect(fetchJobLog.mock.calls.map(stream)).toEqual(["wbm"]);
  });

  it("moves on to Output when there is no WBM log", async () => {
    fetchJobLog.mockImplementation(async (_id: string, s: LogStream) =>
      s === "wbm" ? chunk({ exists: false }) : chunk({ stream: s, data: "out\n", next_offset: 4, size: 4 })
    );
    render(viewer("FAILED", { data: { failure: oom } }));
    await tick(0);
    await tick(0);
    expect(selectedTab()).toBe("Output");
    expect(screen.getByRole("log").textContent).toContain("out");
  });

  it("ends on Errors, with the SLURM-stopped words, when nothing else has text", async () => {
    fetchJobLog.mockResolvedValue(chunk({ exists: false }));
    render(viewer("FAILED", { data: { failure: oom } }));
    for (let i = 0; i < 4; i++) await tick(0);
    expect(selectedTab()).toBe("Errors");
    expect(
      screen.getByText("Nothing was written to stderr. SLURM stopped this job (see the log excerpt in the failure card).")
    ).toBeTruthy();
  });

  it("does not move on from a WBM log that failed to load: its error shows", async () => {
    fetchJobLog.mockResolvedValue({ ok: false, reason: "error", message: "Anvil did not answer.", status: 502 });
    render(viewer("FAILED", { data: { failure: oom } }));
    await tick(0);
    await tick(0);
    expect(selectedTab()).toBe("WBM log");
    expect(screen.getByText("Anvil did not answer.")).toBeTruthy();
    expect(fetchJobLog.mock.calls.map(stream)).toEqual(["wbm"]);
  });

  it("leaves a tab the person picked, even when it is empty", async () => {
    fetchJobLog.mockImplementation(async (_id: string, s: LogStream) =>
      chunk({ stream: s, exists: s === "wbm", data: s === "wbm" ? "x\n" : "", next_offset: s === "wbm" ? 2 : 0 })
    );
    render(viewer("FAILED", { data: { failure: oom } }));
    await tick(0);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Errors" }), { button: 0 });
    await tick(0);
    expect(selectedTab()).toBe("Errors");
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
    // No WBM log was found, so it does not send the reader there.
    expect(screen.getByText("Nothing was written to stderr. SLURM stopped this job.")).toBeTruthy();
    unmount();

    render(viewer("FAILED", { data: { failure: { cause: "wbm_error", phase: null, message: "x", excerpt: null } } }));
    for (let i = 0; i < 4; i++) await tick(0);
    expect(screen.getByText("This job wrote no error output.")).toBeTruthy();
  });
});

describe("LogViewer empty states", () => {
  it("waits for SLURM without reading anything while queued", async () => {
    render(viewer("PENDING"));
    await tick(30_000);
    expect(screen.getByText("Logs appear here once SLURM starts the job.")).toBeTruthy();
    expect(fetchJobLog).not.toHaveBeenCalled();
  });

  it("says WBM has not started its log while running with no file", async () => {
    fetchJobLog.mockResolvedValue(chunk({ exists: false }));
    render(viewer("RUNNING"));
    await tick(0);
    expect(
      screen.getByText("WBM hasn't started writing its log yet. It starts after the model snapshot is fetched.")
    ).toBeTruthy();
  });

  it("says nothing written yet for Output while running", async () => {
    fetchJobLog.mockResolvedValue(chunk({ exists: false, stream: "stdout" }));
    render(viewer("RUNNING"));
    await tick(0);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Output" }), { button: 0 });
    await tick(0);
    expect(screen.getByText("Nothing written yet.")).toBeTruthy();
  });

  it("says Anvil purged the files", async () => {
    fetchJobLog.mockResolvedValue(chunk({ exists: false }));
    render(viewer("COMPLETED", { data: { files: "purged" } }));
    await tick(0);
    expect(screen.getByText("Anvil purged this job's files after 30 days untouched.")).toBeTruthy();
  });

  it("shows skeleton lines until the first read answers", async () => {
    let resolve!: (v: unknown) => void;
    fetchJobLog.mockReturnValue(new Promise((r) => (resolve = r)));
    render(viewer("RUNNING"));
    expect(screen.getByLabelText("Loading the log")).toBeTruthy();
    await act(async () => resolve(chunk({ data: "hello\n", next_offset: 6, size: 6 })));
    expect(screen.queryByLabelText("Loading the log")).toBeNull();
    expect(screen.getByRole("log").textContent).toContain("hello");
  });

  it("shows an inline error with Retry, and recovers", async () => {
    fetchJobLog.mockResolvedValueOnce({ ok: false, reason: "error", message: "Anvil did not answer.", status: 502 });
    fetchJobLog.mockResolvedValue(chunk({ data: "ok\n", next_offset: 3, size: 3 }));
    render(viewer("COMPLETED"));
    await tick(0);
    expect(screen.getByText("Anvil did not answer.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await tick(0);
    expect(screen.queryByText("Anvil did not answer.")).toBeNull();
    expect(screen.getByRole("log").textContent).toContain("ok");
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

describe("LogViewer reading", () => {
  it("tails first, then appends from next_offset, completing a split line", async () => {
    fetchJobLog
      .mockResolvedValueOnce(chunk({ data: "one\ntw", next_offset: 6, size: 6 }))
      .mockResolvedValue(chunk({ data: "o\nthree\n", offset: 6, next_offset: 14, size: 14 }));
    render(viewer("RUNNING"));
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
    await tick(0);
    expect(container.textContent).toContain("Showing the end of a 1.9 MB log.");
    expect(container.textContent).toContain("for the whole file.");
  });

  it("reads only the stream on show, and the other when it is selected", async () => {
    fetchJobLog.mockResolvedValue(chunk({ data: "x\n", next_offset: 2, size: 2 }));
    render(viewer("RUNNING"));
    await tick(0);
    await tick(10_000);
    expect(new Set(fetchJobLog.mock.calls.map((c) => c[1]))).toEqual(new Set(["wbm"]));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Errors" }), { button: 0 });
    await tick(0);
    expect(fetchJobLog).toHaveBeenLastCalledWith("j1", "stderr", undefined);
  });

  it("reads to the end once for an ended job, and then stops", async () => {
    fetchJobLog.mockResolvedValue(chunk({ data: "done\n", next_offset: 5, size: 5 }));
    render(viewer("COMPLETED"));
    await tick(0);
    await tick(60_000);
    expect(fetchJobLog).toHaveBeenCalledTimes(1);
  });

  it("reads nothing while the tab is hidden", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    fetchJobLog.mockResolvedValue(chunk({ data: "x\n", next_offset: 2, size: 2 }));
    render(viewer("RUNNING"));
    await tick(30_000);
    expect(fetchJobLog).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await tick(0);
    expect(fetchJobLog).toHaveBeenCalledTimes(1);
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
    await tick(0);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Download wbm log" })));
    expect(createObjectURL).toHaveBeenCalled();
    expect(saved).toBe("sim-1-wbm.log");
    click.mockRestore();
  });
});

describe("LogViewer default tab", () => {
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
  const live = (status: JobStatus) => (
    <LiveJobProvider jobId="j1" initialStatus={status}>
      <LogViewer />
    </LiveJobProvider>
  );

  it("follows the job from Output to the WBM log when it starts running", async () => {
    fetchJobLog.mockResolvedValue(chunk({ exists: false }));
    pollJobStatus.mockResolvedValueOnce(polled("SUBMITTED")).mockResolvedValue(polled("RUNNING"));
    render(live("SUBMITTED"));
    await tick(0);
    expect(selectedTab()).toBe("Output");
    await tick(5_000);
    expect(selectedTab()).toBe("WBM log");
  });

  it("leaves the tab the person picked when the status changes", async () => {
    fetchJobLog.mockResolvedValue(chunk({ exists: false }));
    pollJobStatus.mockResolvedValueOnce(polled("SUBMITTED")).mockResolvedValue(polled("RUNNING"));
    render(live("SUBMITTED"));
    await tick(0);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Errors" }), { button: 0 });
    expect(selectedTab()).toBe("Errors");
    await tick(5_000);
    expect(selectedTab()).toBe("Errors");
  });
});
