import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { Job, JobLive, JobStatus } from "@/lib/jobs/types";

vi.mock("@/lib/jobs/actions", () => ({
  pollJobStatus: vi.fn(),
  cancelJob: vi.fn(),
  deleteDraft: vi.fn(),
  deriveDraft: vi.fn(),
  duplicateDraft: vi.fn(),
  submitDraft: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/workspace/x",
}));

import { JobStatusSummary } from "@/components/workspace/job-status-summary";
import { LiveJobProvider } from "@/components/workspace/live-job-provider";
import { previewDraftJob } from "@/lib/workspace/fixtures";
import { FAILED_CAUSES, PREVIEW_GROUPS } from "@/lib/workspace/preview";
import { FAILURE_COPY, UNKNOWN_FAILURE_COPY } from "@/lib/workspace/failure-copy";
import { pollJobStatus } from "@/lib/jobs/actions";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// A run 4 min 12 s in: 2001-03-04 is day 429 of the 731 in 2000-01-01..2001-12-31, 59 %.
const QUEUED: JobLive = {
  checked_at: "2026-09-30T12:00:46Z",
  queue_reason: "Priority",
  estimated_start: null,
  time_limit_seconds: 1380,
  progress: null,
};

const RUN_LINE =
  "File wbm_2001.nc (2001-03-04) Balance=(0.00,0.00,0.00,   8.20,  109.09,   0.81,  0.00, 0.00,0.00) Spool+=2";

function runLive(over: Partial<JobLive> = {}): JobLive {
  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
  return {
    checked_at: "2026-09-30T12:04:10Z",
    queue_reason: null,
    estimated_start: null,
    time_limit_seconds: 1380,
    progress: {
      phase: "run",
      loop: null,
      loops: null,
      date: "2001-03-04",
      run_start: "2000-01-01",
      run_end: "2001-12-31",
      fraction: (day("2001-03-04") - day("2000-01-01") + 1) / (day("2001-12-31") - day("2000-01-01") + 1),
      line: RUN_LINE,
      read_at: "2026-09-30T12:04:10Z",
    },
    ...over,
  };
}

/** The summary for `job`, fed the way `JobDetail` feeds the provider. */
function summary(job: Job, { live = null, viewerEmail = null }: { live?: JobLive | null; viewerEmail?: string | null } = {}) {
  return (
    <LiveJobProvider
      jobId={job.id}
      initialStatus={job.status}
      initialData={{
        slurm_job_id: job.slurm_job_id,
        submitted_at: job.submitted_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        status_reason: job.status_reason,
        work_dir: job.work_dir,
        slurm_state: job.slurm_state,
        slurm_exit_code: job.slurm_exit_code,
        slurm_start: job.slurm_start,
        slurm_end: job.slurm_end,
        failure: job.failure,
        cancel_requested_at: job.cancel_requested_at,
        cancel_requested_by_email: job.cancel_requested_by_email,
        files: job.files,
        output: job.output,
        live,
      }}
      preview
    >
      <JobStatusSummary job={job} viewerEmail={viewerEmail} preview />
    </LiveJobProvider>
  );
}

function live(status: JobStatus, over: Partial<Job> = {}) {
  return previewDraftJob(status.toLowerCase(), {
    overrides: {
      submitted_at: "2026-09-30T12:00:00Z",
      started_at: status === "RUNNING" ? "2026-09-30T12:00:00Z" : null,
      ...over,
    },
  });
}

const escape = (t: string) => t.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T12:04:12Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.style.pointerEvents = "";
});

describe("a queued job", () => {
  it("says why in plain words, quotes SLURM's reason, and offers Cancel", () => {
    render(summary(live("PENDING"), { live: QUEUED }));
    expect(screen.getByRole("heading", { name: "In the queue" })).toBeTruthy();
    expect(screen.getByText(/Waiting for higher-priority jobs to start first\./)).toBeTruthy();
    expect(screen.getByText("SLURM: Priority")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel simulation" })).toBeTruthy();
  });

  it("shows an estimate only when SLURM gave one, labelled as SLURM's", () => {
    render(summary(live("PENDING"), { live: QUEUED }));
    expect(screen.queryByText(/SLURM's estimate/)).toBeNull();
    cleanup();
    render(summary(live("PENDING"), { live: { ...QUEUED, estimated_start: "2026-09-30T13:00:00Z" } }));
    expect(screen.getByText(/SLURM's estimate/)).toBeTruthy();
  });

  it("shows a queue reason it has no wording for once, not twice", () => {
    const { container } = render(summary(live("PENDING"), { live: { ...QUEUED, queue_reason: "SomethingNew" } }));
    expect(container.textContent).toContain("Waiting for SLURM to start it.");
    expect(container.textContent?.match(/SomethingNew/g)).toHaveLength(1);
    expect(screen.getByText("SLURM: SomethingNew")).toBeTruthy();
  });

  it("waits gracefully before SLURM has answered", () => {
    const { container } = render(summary(live("SUBMITTED")));
    expect(container.textContent).toContain("In the queue");
    expect(container.textContent).toContain("Waiting for SLURM to schedule it.");
    expect(container.textContent).toContain("Checking with SLURM…");
    expect(container.textContent).not.toContain("SLURM:");
  });

  it("leaves the times to the Run details card, which counts the wait", () => {
    const { container } = render(summary(live("PENDING"), { live: QUEUED }));
    expect(container.textContent).not.toMatch(/Submitted|Waiting \d/);
  });

  it("opens the Cancel dialog, and puts focus back on the button when it is dismissed", async () => {
    render(summary(live("PENDING"), { live: QUEUED }));
    const cancel = screen.getByRole("button", { name: "Cancel simulation" });
    fireEvent.click(cancel);
    expect(await screen.findByText("Cancel this simulation?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep running" }));
    await waitFor(() => expect(screen.queryByText("Cancel this simulation?")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(cancel));
  });

  it("renders the same on the server twice", () => {
    const html = () => renderToString(summary(live("PENDING"), { live: QUEUED }));
    expect(html()).toBe(html());
  });
});

describe("a running job", () => {
  it("shows elapsed against the walltime, and the simulated date with a percentage", () => {
    const { container } = render(summary(live("RUNNING"), { live: runLive() }));
    expect(screen.getByRole("heading", { name: "Running" })).toBeTruthy();
    expect(container.textContent).toContain("Elapsed 4 min 12 s of 23 min walltime");
    expect(container.textContent).toContain("Simulating 2001-03-04 · run 2000-01-01 → 2001-12-31 · 59 %");

    const bars = screen.getAllByRole("progressbar");
    expect(bars.map((b) => b.getAttribute("aria-label"))).toEqual(["Simulation progress", "Walltime used"]);
    expect(bars[0].getAttribute("aria-valuenow")).toBe("59");
    expect(bars[1].getAttribute("aria-valuenow")).toBe("18");
    // Elapsed against walltime is labelled as such, with no percentage of its own.
    expect(container.textContent).not.toContain("18 %");
    expect(screen.getByRole("button", { name: "Cancel simulation" })).toBeTruthy();
  });

  it("turns the walltime bar amber at 80 % and red at 95 %", () => {
    vi.setSystemTime(new Date("2026-09-30T12:19:00Z")); // 1140 s of 1380: 83 %
    const { container } = render(summary(live("RUNNING"), { live: runLive() }));
    expect(container.innerHTML).toContain("bg-status-running");
    cleanup();
    vi.setSystemTime(new Date("2026-09-30T12:22:00Z")); // 1320 s: 96 %
    const again = render(summary(live("RUNNING"), { live: runLive() }));
    expect(again.container.innerHTML).toContain("bg-status-failed");
  });

  it("explains that a spin-up has no percentage", () => {
    const l = runLive();
    l.progress = { ...l.progress!, phase: "spinup", loop: 1, loops: 1, date: "2000-06-12", fraction: null };
    const { container } = render(summary(live("RUNNING"), { live: l }));
    expect(container.textContent).toContain("Spin-up 1 of 1 · simulating 2000-06-12");
    expect(container.textContent).toContain("Spin-up length isn't reported, so no percentage.");
    expect(screen.getAllByRole("progressbar")).toHaveLength(1); // walltime only
  });

  it("says WBM hasn't reported a date, and keeps the walltime line", () => {
    const { container } = render(summary(live("RUNNING"), { live: runLive({ progress: null }) }));
    expect(container.textContent).toContain("WBM hasn't reported a simulated date yet.");
    expect(container.textContent).toContain("Elapsed 4 min 12 s of 23 min walltime");
  });

  it("uses slurm_start ahead of started_at", () => {
    const { container } = render(
      summary(live("RUNNING", { slurm_start: "2026-09-30T12:02:12Z" }), { live: runLive() })
    );
    expect(container.textContent).toContain("Elapsed 2 min of 23 min walltime");
  });

  it("prints nothing that depends on the clock on the server", () => {
    const html = renderToString(summary(live("RUNNING"), { live: runLive() }));
    expect(html).not.toContain("Elapsed");
    expect(html).toContain("23 min walltime");
  });

  it("shows Cancelling and no Cancel button once a cancel is waiting on SLURM", () => {
    render(summary(live("RUNNING", { cancel_requested_at: "2026-09-30T12:04:00Z" }), { live: runLive() }));
    expect(screen.getByRole("heading", { name: "Cancelling" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel simulation" })).toBeNull();
  });

  it("has no Cancel button while COMPLETING", () => {
    render(summary(live("COMPLETING"), { live: runLive() }));
    expect(screen.getByRole("heading", { name: "Completing" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel simulation" })).toBeNull();
  });
});

describe("the freshness line", () => {
  it("counts from SLURM's own timestamp", () => {
    const { container } = render(summary(live("RUNNING"), { live: runLive() }));
    expect(container.textContent).toContain("Checked with SLURM 2 s ago");
  });

  it("says it is checking before SLURM has answered, and nothing once the job is over", () => {
    const first = render(summary(live("RUNNING")));
    expect(first.container.textContent).toContain("Checking with SLURM…");
    cleanup();
    const over = render(summary(previewDraftJob("completed")));
    expect(over.container.textContent).not.toContain("SLURM…");
    expect(over.container.textContent).not.toContain("Checked with SLURM");
  });
});

describe("a completed job", () => {
  it("says how long it ran and shows the path, the manifest and the retention line", () => {
    const job = previewDraftJob("completed");
    const { container } = render(summary(job));
    expect(screen.getByRole("heading", { name: "Completed in 1 h" })).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text).toContain(job.work_dir!);
    expect(text).toContain(`${job.output!.file_count} files`);
    expect(text).toMatch(/Anvil deletes these files around \w+ \d+, \d{4} if unused — copy what you need\./);
    // Nothing publishes a simulation, and nothing here says it might.
    expect(text).not.toMatch(/publish|illustrative|not wired/i);
    expect(screen.getByRole("button", { name: "Copy path" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Show file list/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel simulation" })).toBeNull();
  });

  it("draws the run as a bar of the queued and the run time, in proportion, with the three times under it", () => {
    // The fixture submitted 3 h ago, started 2 h ago and ended 1 h ago.
    const { container } = render(summary(previewDraftJob("completed")));
    const queued = container.querySelector<HTMLElement>("[data-testid=timeline-queued]")!;
    const ran = container.querySelector<HTMLElement>("[data-testid=timeline-ran]")!;
    expect(queued.style.flexGrow).toBe(ran.style.flexGrow);
    expect(container.textContent).toContain("Submitted · queued 1 h");
    expect(container.textContent).toContain("Started · ran 1 h");
    expect(container.textContent).toContain("Ended");
    // Three times: when it was submitted, started and ended.
    expect(container.querySelectorAll("section[aria-label=Status] time[datetime]").length).toBeGreaterThanOrEqual(4);
  });

  it("says the day it ended, with the zone, on the right of the heading", () => {
    const job = previewDraftJob("completed");
    const { container } = render(summary(job));
    const day = container.querySelector(`section[aria-label=Status] > div > time[datetime="${job.completed_at}"]`) as HTMLElement;
    expect(day.className).toContain("font-mono");
    expect(day.textContent).toMatch(/\d{4} · \S+$/);
  });

  it("draws no timeline for a job that is not completed", () => {
    const { container } = render(summary(previewDraftJob("failed:timeout")));
    expect(container.querySelector("[data-testid=timeline-ran]")).toBeNull();
  });

  it("lays the results out as a tinted box with the path and a filled Copy, then the figures, then the retention line", () => {
    const job = previewDraftJob("completed");
    render(summary(job));
    const box = screen.getByText("Results on Anvil scratch").parentElement!;
    expect(box.className).toContain("bg-secondary");
    expect(within(box).getByText(job.work_dir!).tagName).toBe("CODE");
    expect(within(box).getByRole("button", { name: "Copy path" }).className).toContain("bg-primary");
    const files = screen.getByText("files");
    expect(files.previousElementSibling?.className).toContain("font-mono");
    expect(files.previousElementSibling?.textContent).toBe(String(job.output!.file_count));
    expect(screen.getByText(/Anvil deletes these files around/).closest("p")?.className).toContain("bg-warning/10");
  });

  it("shows only the purge notice when the files are gone", () => {
    const { container } = render(summary(previewDraftJob("completed:purged")));
    expect(container.textContent).toContain("purge removed this simulation");
    expect(container.textContent).not.toContain("Results on Anvil scratch");
  });

  it("is honest about an old job with no record of its output", () => {
    const { container } = render(summary(previewDraftJob("completed:legacy")));
    expect(container.textContent).toContain("before the gateway recorded what it wrote");
  });
});

describe("a failed job", () => {
  it.each(FAILED_CAUSES)("%s shows its title and the backend's message", (cause) => {
    const job = previewDraftJob(`failed:${cause}`);
    const html = renderToString(summary(job));
    expect(html).toContain(escape(FAILURE_COPY[cause].title));
    expect(html).toContain(escape(job.failure!.message));
    if (job.failure?.excerpt) expect(html).toMatch(/(Show l|L)og excerpt/);
    if (job.slurm_state) expect(html).toContain(job.slurm_state);
  });

  it("opens a short excerpt, and keeps a long one behind Show log excerpt", () => {
    const base = previewDraftJob("failed:out_of_memory");
    const slurmLine = "error: Detected 1 oom_kill event in StepId=1.batch. Some of the step tasks have been OOM Killed.";
    const shortHtml = renderToString(summary({ ...base, failure: { ...base.failure!, excerpt: slurmLine } }));
    expect(shortHtml).toContain("<pre");
    expect(shortHtml).toContain("oom_kill event");
    expect(shortHtml).not.toContain("Show log excerpt");
    expect(shortHtml).toContain("Copy log excerpt");

    const lines = Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n");
    const longHtml = renderToString(summary({ ...base, failure: { ...base.failure!, excerpt: lines } }));
    expect(longHtml).not.toContain("<pre");
    expect(longHtml).toContain("Show log excerpt");
    expect(longHtml).toContain("Copy log excerpt");
  });

  it("offers to try again right there, and says to pick a longer walltime after a timeout", () => {
    render(summary(previewDraftJob("failed:timeout")));
    expect(screen.getByRole("button", { name: "Try again with these settings" })).toBeTruthy();
    expect(screen.getByText(/longer walltime/)).toBeTruthy();
    expect(screen.queryByText("Start a new draft")).toBeNull();
  });

  it("shows a generic title and the backend's message for a cause it has no wording for, instead of crashing", () => {
    const job = previewDraftJob("failed:wbm_error");
    const odd = { ...job, failure: { ...job.failure!, cause: "brand_new_cause" as never, message: "Something new went wrong." } };
    const html = renderToString(summary(odd));
    expect(html).toContain(escape(UNKNOWN_FAILURE_COPY.title));
    expect(html).toContain("Something new went wrong.");
    // The failure card is built too: the copy action is offered.
    expect(html).toContain("Try again with these settings");
    cleanup();
    render(summary({ ...odd, failure: { ...odd.failure!, message: "" } }));
    expect(screen.getByText(UNKNOWN_FAILURE_COPY.body)).toBeTruthy();
  });

  it("offers nothing to retry after a cause that has no next step", () => {
    const job = previewDraftJob("failed:wbm_error");
    const none = { ...job, failure: { ...job.failure!, cause: "cancelled_by_user" as const } };
    expect(renderToString(summary(none))).not.toContain("Try again with these settings");
  });

  it("shows the backend's message and not the per-cause body", () => {
    const job = previewDraftJob("failed:out_of_memory");
    const html = renderToString(summary(job));
    expect(html).toContain(escape(job.failure!.message));
    expect(html).not.toContain(escape(FAILURE_COPY.out_of_memory.body));
  });

  it.each(FAILED_CAUSES)("shows the per-cause body when %s has no message", (cause) => {
    const base = previewDraftJob(`failed:${cause}`);
    const html = renderToString(summary({ ...base, failure: { ...base.failure!, message: "" } }));
    expect(html).toContain(escape(FAILURE_COPY[cause].body));
  });

  it("falls back to the stored reason for a job with no verdict", () => {
    const job = { ...previewDraftJob("failed:wbm_error"), failure: null, status_reason: "old reason" };
    const html = renderToString(summary(job));
    expect(html).toContain("The simulation failed");
    expect(html).toContain("old reason");
  });

  it("is an amber warning when a limit was hit, and red otherwise", () => {
    expect(renderToString(summary(previewDraftJob("failed:timeout")))).toContain("bg-status-running/10");
    expect(renderToString(summary(previewDraftJob("failed:wbm_error")))).toContain("bg-status-failed/10");
  });
});

describe("a cancelled job", () => {
  it("says you, someone else, and Anvil", () => {
    const you = previewDraftJob("cancelled:user", { viewerEmail: "me@purdue.edu" });
    expect(renderToString(summary(you, { viewerEmail: "me@purdue.edu" }))).toContain("You cancelled this simulation");
    const other = previewDraftJob("cancelled:other");
    expect(renderToString(summary(other, { viewerEmail: "me@purdue.edu" }))).toContain(
      "Cancelled by colleague@example.test"
    );
    const system = previewDraftJob("cancelled:system");
    expect(renderToString(summary(system, { viewerEmail: "me@purdue.edu" }))).toContain(
      "Cancelled by Anvil or an administrator"
    );
  });

  it("offers to try again with these settings, not to start over from the snapshot", () => {
    render(summary(previewDraftJob("cancelled:user")));
    expect(screen.getByRole("button", { name: "Try again with these settings" })).toBeTruthy();
    expect(screen.queryByText("Start a new draft")).toBeNull();
  });

  it("renders the same twice, so hydration has nothing to disagree about", () => {
    const job = previewDraftJob("cancelled:user", { overrides: { cancel_requested_at: "2026-09-30T10:00:00Z" } });
    expect(renderToString(summary(job))).toBe(renderToString(summary(job)));
  });
});

describe("every preview", () => {
  const all = PREVIEW_GROUPS.flatMap((g) => g.options);
  it.each(all.map((o) => o.key))("builds a job for %s, and the summary renders it", (key) => {
    const job = previewDraftJob(key);
    expect(job.status).toBe(all.find((o) => o.key === key)!.status);
    expect(() => renderToString(summary(job))).not.toThrow();
  });
});


describe("a snapshot draft that was deleted while its page was open", () => {
  it("says it no longer exists, links to My snapshot drafts, and offers neither Cancel nor Refresh", async () => {
    vi.mocked(pollJobStatus).mockResolvedValue({ ok: false, reason: "not_found" });
    const job = live("RUNNING");
    render(
      <LiveJobProvider jobId={job.id} initialStatus="RUNNING" initialData={{ started_at: job.started_at }}>
        <JobStatusSummary job={job} viewerEmail={null} />
      </LiveJobProvider>
    );
    // Before the answer: the controls are there.
    expect(screen.getByRole("button", { name: "Cancel simulation" })).toBeTruthy();

    expect(await screen.findByText("This snapshot draft no longer exists.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "My snapshot drafts" }).getAttribute("href")).toBe("/workspace");
    expect(screen.queryByRole("button", { name: "Cancel simulation" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Refresh|Retry now/ })).toBeNull();
    expect(screen.queryByText(/Checking with SLURM|Checked with SLURM/)).toBeNull();
  });
});
