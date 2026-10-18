import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/jobs/actions", () => ({ pollJobStatus: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/workspace/x",
}));

import { RunDetailsCard } from "@/components/workspace/run-details-card";
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
        slurm_job_id: job.slurm_job_id,
        submitted_at: job.submitted_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        work_dir: job.work_dir,
        files: job.files,
        cancel_requested_at: job.cancel_requested_at,
        previous_jobs: job.previous_jobs,
        job_number: job.job_number,
        max_jobs: job.max_jobs,
        continuation: job.continuation,
        live,
      }}
      preview
    >
      <RunDetailsCard job={job} recommended={recommended} />
    </LiveJobProvider>
  );
}

const VARIABLES = Array.from({ length: 51 }, (_, i) => `var${i + 1}`);

describe("the run details card", () => {
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

  it("gives each output variable a chip with a swatch from the categorical colours, in turn", () => {
    details(previewDraftJob("completed"), null);
    const chips = ["discharge", "runoff", "streamAge"].map((v) => screen.getByText(v));
    chips.forEach((chip, i) => {
      expect(chip.className).toContain("rounded-full");
      expect(chip.firstElementChild?.className).toContain(`bg-data-${i + 1}`);
    });
  });

  it("draws the run period against the base snapshot's coverage when it is known", () => {
    const job = previewDraftJob("completed");
    const base = { ...job.parameters, temporal_range_start: "2000-01-01", temporal_range_end: "2001-12-31" };
    const { container } = render(
      <LiveJobProvider jobId={job.id} initialStatus={job.status} initialData={{}} preview>
        <RunDetailsCard
          job={{ ...job, parameters: base }}
          recommended={null}
          coverage={{ start: "2000-01-01", end: "2009-12-31" }}
        />
      </LiveJobProvider>
    );
    const fill = container.querySelector<HTMLElement>("[data-testid=run-period-track]")!;
    expect(fill.style.left).toBe("0%");
    expect(parseFloat(fill.style.width)).toBeCloseTo(20, 0);
    cleanup();
    expect(details(job, null).container.querySelector("[data-testid=run-period-track]")).toBeNull();
  });

  it("shows the walltime a finished run used, against the limit, when both are known", () => {
    // Ran 1 h of a 3 h walltime.
    const job = previewDraftJob("completed", { overrides: { slurm_config: { cores: 4, walltime: "03:00:00" } } });
    const { container } = details(job, null);
    const bar = screen.getByRole("progressbar", { name: "Walltime used" });
    expect(bar.getAttribute("aria-valuenow")).toBe("33");
    expect(container.textContent).toContain("1 h / 3 h");
    cleanup();
    // Nothing to compare against: no bar.
    details(previewDraftJob("completed", { overrides: { slurm_config: { cores: null, walltime: null } } }), null);
    expect(screen.queryByRole("progressbar", { name: "Walltime used" })).toBeNull();
  });

  it("has no toggle when every variable is already shown", () => {
    details(previewDraftJob("completed"), null);
    expect(screen.queryByRole("button", { name: /Show/ })).toBeNull();
  });

  it("shows the output the draft chose, in the same words as the review", () => {
    const base = previewDraftJob("completed").parameters;
    const climatology = previewDraftJob("completed", {
      overrides: { parameters: { ...base, post_processing: "climatology" } },
    });
    const first = details(climatology, null);
    expect(first.container.textContent).toContain("Post-processingOn");
    cleanup();

    const standard = previewDraftJob("completed", {
      overrides: { parameters: { ...base, post_processing: "standard" } },
    });
    const second = details(standard, null);
    expect(second.container.textContent).toContain("Post-processingOff");
  });

  it("has no Output row when the draft left the output to the snapshot", () => {
    const { container } = details(previewDraftJob("completed"), null);
    expect(container.textContent).not.toContain("Post-processing");
  });
});

/** The text of the card's line whose label is `label`: its value. */
const value = (label: string) =>
  (screen.getByText(label, { selector: "dt" }).parentElement as HTMLElement).querySelector("dd")?.textContent;

describe("the run details card: what the page says once", () => {
  it("is headed Run details and says which snapshot it is based on, as a link with the whole title on hover", () => {
    const title = "WBM v1.0.0 Global_tracking snapshot draft for 'Water balance model (WBM) v.1.0.0': [Global] [2000-2009]";
    const job = previewDraftJob("completed", { overrides: { dataset_title: title } });
    details(job, null);
    expect(screen.getByRole("heading", { level: 2, name: "Run details" })).toBeTruthy();
    const link = screen.getByRole("link", { name: title });
    expect(link.getAttribute("href")).toBe(`/repository/${job.dataset_id}`);
    expect(link.getAttribute("title")).toBe(title);
    expect(screen.getByText("Based on", { selector: "dt" })).toBeTruthy();
  });

  it("has the run period, the Slurm job and the run id", () => {
    const job = previewDraftJob("completed");
    details(job, null);
    // 2001-01-01 to 2001-12-31 is one whole year, written as the list writes it.
    expect(value("Run period")).toBe("2001");
    expect(value("Slurm job")).toBe(`#${job.slurm_job_id}`);
    expect(value("Run ID")).toBe(job.sim_id);
  });

  it("leaves out the Slurm job a draft has not got", () => {
    const job = previewDraftJob("completed", { overrides: { slurm_job_id: null } });
    details(job, null);
    expect(screen.queryByText("Slurm job", { selector: "dt" })).toBeNull();
  });

  it("has the times of a completed run, each with how long it took", () => {
    // Submitted 3 h ago, started 2 h ago, ended 1 h ago (the fixture's).
    details(previewDraftJob("completed"), null);
    expect(screen.getByText("Submitted", { selector: "dt" })).toBeTruthy();
    expect(value("Started")).toMatch(/\(waited 1 h\)$/);
    expect(value("Ended")).toMatch(/\(ran 1 h\)$/);
    expect(screen.queryByText("Cancel requested", { selector: "dt" })).toBeNull();
  });

  it("counts a continued job's wait from the end of the job before it, not from the first submit", () => {
    // Submitted 3 h ago; the first job ended 2 h 5 min ago and the second started 2 h ago.
    details(previewDraftJob("completed:continued"), null);
    expect(value("Started")).toMatch(/\(waited 5 min\)$/);
    expect(value("Ended")).toMatch(/\(ran 1 h\)$/);
  });

  it("has no Ended row while the run is going, and says how long a queued one has waited", () => {
    details(previewDraftJob("running"), null);
    expect(screen.getByText("Started", { selector: "dt" })).toBeTruthy();
    expect(screen.queryByText("Ended", { selector: "dt" })).toBeNull();
    cleanup();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T12:04:12Z"));
    try {
      details(previewDraftJob("pending", { overrides: { submitted_at: "2026-09-30T12:00:00Z" } }), null);
      expect(value("Submitted")).toMatch(/\(waiting 4 min\)$/);
      expect(screen.queryByText("Started", { selector: "dt" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows when a cancel was asked for on a job that has ended", () => {
    details(previewDraftJob("cancelled:user"), null);
    expect(screen.getByText("Cancel requested", { selector: "dt" })).toBeTruthy();
  });

  it("does not repeat the results path of a completed run: the status summary has it", () => {
    const job = previewDraftJob("completed");
    const { container } = details(job, null);
    expect(container.textContent).not.toContain(job.work_dir!);
    expect(screen.queryByText("Work directory", { selector: "dt" })).toBeNull();
  });

  it("shows the work directory, with a copy button, where the summary has no results", () => {
    const job = previewDraftJob("failed:wbm_error");
    details(job, null);
    expect(value("Work directory")).toContain(job.work_dir!);
    expect(screen.getByRole("button", { name: "Copy path" })).toBeTruthy();
    cleanup();
    // A completed run whose files were purged has no results block to point at.
    const purged = previewDraftJob("completed:purged");
    details(purged, null);
    expect(value("Work directory")).toContain(purged.work_dir!);
  });
});
