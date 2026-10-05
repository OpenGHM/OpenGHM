import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/jobs/actions", () => ({ pollJobStatus: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/workspace/x",
}));

import { JobDetails } from "@/components/workspace/job-details";
import { LiveJobProvider } from "@/components/workspace/live-job-provider";
import type { Job, JobLive } from "@/lib/jobs/types";
import { previewDraftJob } from "@/lib/workspace/fixtures";

afterEach(cleanup);

function details(job: Job, recommended: { cores: number; walltime: string } | null, live: JobLive | null = null) {
  return render(
    <LiveJobProvider
      jobId={job.id}
      initialStatus={job.status}
      initialData={{
        submitted_at: job.submitted_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        work_dir: job.work_dir,
        live,
      }}
      preview
    >
      <JobDetails job={job} recommended={recommended} />
    </LiveJobProvider>
  );
}

const VARIABLES = Array.from({ length: 51 }, (_, i) => `var${i + 1}`);

describe("the details", () => {
  it("shows the cores and walltime the draft chose, as they are", () => {
    const job = previewDraftJob("completed", { overrides: { slurm_config: { cores: 26, walltime: "10:00:00" } } });
    const { container } = details(job, { cores: 16, walltime: "15:00" });
    expect(container.textContent).toContain("Cores26");
    expect(container.textContent).toContain("Walltime10 h");
    expect(container.textContent).not.toContain("recommended");
  });

  it("shows the snapshot's recommendation as numbers, marked as recommended", () => {
    const job = previewDraftJob("completed", { overrides: { slurm_config: { cores: null, walltime: null } } });
    const { container } = details(job, { cores: 16, walltime: "15:00" });
    expect(container.textContent).toContain("Cores16(recommended)");
    // 15 min plus 50%: what the submit asked SLURM for.
    expect(container.textContent).toContain("Walltime22 min 30 s(recommended + 50%)");
    expect(container.textContent).not.toMatch(/Model snapshot's recommendation/);
  });

  it("shows a dash, not a guess, when there is nothing to work it out from", () => {
    const job = previewDraftJob("completed", { overrides: { slurm_config: { cores: null, walltime: null } } });
    const { container } = details(job, null);
    expect(container.textContent).toContain("Cores—");
    expect(container.textContent).toContain("Walltime—");
  });

  it("prefers the limit SLURM enforces while it has the job", () => {
    const job = previewDraftJob("running", { overrides: { slurm_config: { cores: null, walltime: null } } });
    const live: JobLive = {
      checked_at: "2026-09-30T12:00:00Z",
      queue_reason: null,
      estimated_start: null,
      time_limit_seconds: 7200,
      progress: null,
    };
    const { container } = details(job, { cores: 16, walltime: "15:00" }, live);
    expect(container.textContent).toContain("Walltime2 h");
    expect(container.textContent).not.toContain("recommended +");
  });

  it("counts the output variables, shows the first few, and expands on request", () => {
    const job = previewDraftJob("completed", {
      overrides: { parameters: { ...previewDraftJob("completed").parameters, variables: VARIABLES } },
    });
    details(job, null);
    expect(screen.getByText("51")).toBeTruthy();
    expect(screen.getByText("var1")).toBeTruthy();
    expect(screen.queryByText("var7")).toBeNull();
    const toggle = screen.getByRole("button", { name: "Show all 51" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByText("var51")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show fewer" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("has no toggle when every variable is already shown", () => {
    details(previewDraftJob("completed"), null);
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
  });
});
