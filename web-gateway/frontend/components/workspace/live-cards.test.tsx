import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { JobLive, JobStatus, JobStatusResponse } from "@/lib/jobs/types";

vi.mock("@/lib/jobs/actions", () => ({ pollJobStatus: vi.fn(), cancelJob: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/workspace/x",
}));

import { LiveJobProvider } from "@/components/workspace/live-job-provider";
import { QueuedNoticeCard } from "@/components/workspace/queued-notice-card";
import { RunningProgressCard } from "@/components/workspace/running-progress-card";
import { JobStatusPanel } from "@/components/workspace/job-status-panel";

// Real shapes: the squeue-derived queued answer, and a run 4 min 12 s in.
// 2001-03-04 is day 429 of the 731 in 2000-01-01..2001-12-31: 59 %.
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

function ui(status: JobStatus, live: JobLive | null, data: Partial<JobStatusResponse> = {}, child: React.ReactNode) {
  return (
    <LiveJobProvider
      jobId="j1"
      initialStatus={status}
      initialData={{
        submitted_at: "2026-09-30T12:00:00Z",
        started_at: status === "RUNNING" ? "2026-09-30T12:00:00Z" : null,
        live,
        ...data,
      }}
      preview
    >
      {child}
    </LiveJobProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T12:04:12Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("QueuedNoticeCard", () => {
  it("says why in plain words and quotes SLURM's reason", () => {
    render(ui("PENDING", QUEUED, {}, <QueuedNoticeCard status="PENDING" />));
    expect(screen.getByText("Waiting for higher-priority jobs to start first.")).toBeTruthy();
    expect(screen.getByText("SLURM: Priority")).toBeTruthy();
    expect(screen.getByText("Waiting since")).toBeTruthy();
    expect(screen.getByText(/Pending — waiting on SLURM/)).toBeTruthy();
  });

  it("shows an estimate only when SLURM gave one, labelled as SLURM's", () => {
    render(ui("PENDING", QUEUED, {}, <QueuedNoticeCard status="PENDING" />));
    expect(screen.queryByText("SLURM's estimate")).toBeNull();
    cleanup();
    render(
      ui("PENDING", { ...QUEUED, estimated_start: "2026-09-30T13:00:00Z" }, {}, <QueuedNoticeCard status="PENDING" />)
    );
    expect(screen.getByText("SLURM's estimate")).toBeTruthy();
  });

  it("word SUBMITTED as before, and waits gracefully before SLURM has answered", () => {
    const { container } = render(ui("SUBMITTED", null, {}, <QueuedNoticeCard status="SUBMITTED" />));
    expect(container.textContent).toContain("Submitted to Anvil — waiting on SLURM");
    expect(container.textContent).toContain("Waiting for SLURM to schedule it.");
    expect(container.textContent).not.toContain("SLURM:");
    expect(container.textContent).not.toMatch(/does not report|not wired|illustrative/i);
  });

  it("renders the same on the server twice", () => {
    const html = () => renderToString(ui("PENDING", QUEUED, {}, <QueuedNoticeCard status="PENDING" />));
    expect(html()).toBe(html());
  });
});

describe("RunningProgressCard", () => {
  it("shows elapsed against the walltime, and the simulated date with a percentage", () => {
    const { container } = render(ui("RUNNING", runLive(), {}, <RunningProgressCard />));
    expect(container.textContent).toContain("Elapsed 4 min 12 s of 23 min walltime");
    expect(container.textContent).toContain("Simulating 2001-03-04 · run 2000-01-01 → 2001-12-31 · 59 %");
    expect(container.textContent).toContain("Walltime used");

    const bars = screen.getAllByRole("progressbar");
    expect(bars.map((b) => b.getAttribute("aria-label"))).toEqual(["Simulation progress", "Walltime used"]);
    expect(bars[0].getAttribute("aria-valuenow")).toBe("59");
    expect(bars[1].getAttribute("aria-valuenow")).toBe("18");
    // Elapsed against walltime is labelled as such, with no percentage of its own.
    expect(container.textContent).not.toContain("18 %");
  });

  it("turns the walltime bar amber at 80 % and red at 95 %", () => {
    vi.setSystemTime(new Date("2026-09-30T12:19:00Z")); // 1140 s of 1380: 83 %
    const { container } = render(ui("RUNNING", runLive(), {}, <RunningProgressCard />));
    expect(container.innerHTML).toContain("bg-status-running");
    cleanup();
    vi.setSystemTime(new Date("2026-09-30T12:22:00Z")); // 1320 s: 96 %
    const again = render(ui("RUNNING", runLive(), {}, <RunningProgressCard />));
    expect(again.container.innerHTML).toContain("bg-status-failed");
  });

  it("explains that a spin-up has no percentage", () => {
    const live = runLive();
    live.progress = { ...live.progress!, phase: "spinup", loop: 1, loops: 1, date: "2000-06-12", fraction: null };
    const { container } = render(ui("RUNNING", live, {}, <RunningProgressCard />));
    expect(container.textContent).toContain("Spin-up 1 of 1 · simulating 2000-06-12");
    expect(container.textContent).toContain("Spin-up length isn't reported, so no percentage.");
    expect(screen.getAllByRole("progressbar")).toHaveLength(1); // walltime only
  });

  it("says WBM hasn't reported a date, and keeps the walltime line", () => {
    const { container } = render(ui("RUNNING", runLive({ progress: null }), {}, <RunningProgressCard />));
    expect(container.textContent).toContain("WBM hasn't reported a simulated date yet.");
    expect(container.textContent).toContain("Elapsed 4 min 12 s of 23 min walltime");
  });

  it("uses slurm_start ahead of started_at", () => {
    const { container } = render(
      ui("RUNNING", runLive(), { slurm_start: "2026-09-30T12:02:12Z" }, <RunningProgressCard />)
    );
    expect(container.textContent).toContain("Elapsed 2 min of 23 min walltime");
  });

  it("prints nothing that depends on the clock on the server", () => {
    const html = renderToString(ui("RUNNING", runLive(), {}, <RunningProgressCard />));
    expect(html).not.toContain("Elapsed");
    expect(html).toContain("23 min walltime");
  });
});

describe("the freshness line", () => {
  it("counts from SLURM's own timestamp", () => {
    const { container } = render(ui("RUNNING", runLive(), {}, <JobStatusPanel preview />));
    expect(container.textContent).toContain("Checked with SLURM 2 s ago");
  });

  it("says it is checking before SLURM has answered, and nothing once the job is over", () => {
    const first = render(ui("RUNNING", null, {}, <JobStatusPanel preview />));
    expect(first.container.textContent).toContain("Checking with SLURM…");
    cleanup();
    const over = render(ui("COMPLETED", null, {}, <JobStatusPanel preview />));
    expect(over.container.textContent).not.toContain("SLURM…");
    expect(over.container.textContent).not.toContain("Checked with SLURM");
  });
});
