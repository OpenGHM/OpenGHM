import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JobStatus, JobStatusResponse } from "@/lib/jobs/types";

const { pollJobStatus, refresh } = vi.hoisted(() => ({
  pollJobStatus: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/jobs/actions", () => ({
  pollJobStatus,
  cancelJob: vi.fn(),
  deleteSimulation: vi.fn(),
  deriveSimulation: vi.fn(),
  duplicateSimulation: vi.fn(),
  submitSimulation: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  usePathname: () => "/workspace/x",
}));

import { JobHero } from "@/components/workspace/job-hero";
import { LiveJobProvider } from "@/components/workspace/live-job-provider";
import { previewSimulation } from "@/lib/workspace/fixtures";

// Radix's popper and focus code read browser APIs jsdom does not have.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  pollJobStatus.mockReset();
  refresh.mockReset();
});
afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = "";
});

function renderHero(key: string, { preview = true }: { preview?: boolean } = {}) {
  const job = previewSimulation(key);
  return render(
    <LiveJobProvider
      jobId={job.id}
      initialStatus={job.status}
      initialData={{
        cancel_requested_at: job.cancel_requested_at,
        work_dir: job.work_dir,
        files: job.files,
      }}
      preview={preview}
    >
      <JobHero job={job} preview={preview} />
    </LiveJobProvider>
  );
}

const button = (name: string) => screen.queryByRole("button", { name });

describe("the header", () => {
  it("has no actions while the job is active: Cancel is in the status summary", () => {
    for (const key of ["pending", "submitted", "running", "completing", "cancelling"]) {
      renderHero(key);
      expect(button("Cancel")).toBeNull();
      expect(button("New from this model snapshot")).toBeNull();
      expect(button("Delete simulation")).toBeNull();
      cleanup();
    }
  });

  it.each(["completed", "failed:timeout", "cancelled:user"])(
    "shows New from this model snapshot and Delete, as buttons, once %s",
    (key) => {
      renderHero(key);
      expect(button("New from this model snapshot")).not.toBeNull();
      expect(button("Delete simulation")).not.toBeNull();
      expect(screen.queryByRole("menu")).toBeNull();
      expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
      expect(button("Cancel")).toBeNull();
    }
  );

  it.each(["completed", "failed:timeout", "cancelled:user"])(
    "does not repeat the retry the status summary has, once %s",
    (key) => {
      renderHero(key);
      expect(button("Try again with these settings")).toBeNull();
    }
  );

  it("titles the page with the simulation's name, with the status beside it and the snapshot under it", () => {
    renderHero("running");
    const job = previewSimulation("running");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(job.sim_id);
    expect(screen.getByText("Running")).toBeTruthy();
    const link = screen.getByRole("link", { name: `Based on ${job.dataset_title}` });
    expect(link.getAttribute("href")).toBe(`/repository/${job.dataset_id}`);
    expect(link.getAttribute("title")).toBe(`Based on ${job.dataset_title}`);
    expect(screen.queryByText(`Slurm #${job.slurm_job_id}`)).toBeTruthy();
  });

  it("titles it with the name its owner gave it, and keeps the run id in the small line", () => {
    const job = previewSimulation("completed", { overrides: { about: { name: "My CONUS run" } } });
    render(
      <LiveJobProvider jobId={job.id} initialStatus={job.status} initialData={{}} preview>
        <JobHero job={job} preview />
      </LiveJobProvider>
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("My CONUS run");
    expect(screen.getByText(new RegExp(job.sim_id))).toBeTruthy();
  });

  it("has the breadcrumb inside the hero", () => {
    renderHero("completed");
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav.querySelector("a")?.getAttribute("href")).toBe("/workspace");
    expect(screen.queryByText("Back to Simulations")).toBeNull();
  });
});

function answer(status: JobStatus): JobStatusResponse {
  const job = previewSimulation("running");
  return {
    job_id: job.id,
    sim_id: job.sim_id,
    status,
    slurm_job_id: job.slurm_job_id,
    submitted_at: job.submitted_at,
    started_at: job.started_at,
    completed_at: new Date().toISOString(),
    status_reason: null,
    work_dir: job.work_dir,
    slurm_state: null,
    slurm_exit_code: null,
    slurm_start: null,
    slurm_end: null,
    failure: null,
    cancel_requested_at: null,
    cancel_requested_by_email: null,
    files: "present",
    output: null,
    live: null,
  };
}

describe("when the status moves on", () => {
  it("gains its buttons and announces the new status, without a reload", async () => {
    pollJobStatus.mockResolvedValue({ ok: true, data: answer("CANCELLED") });
    renderHero("running", { preview: false });

    // First render: no buttons, and nothing announced.
    expect(button("Delete simulation")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");

    await waitFor(() => expect(button("Delete simulation")).not.toBeNull());
    expect(screen.getByRole("status").textContent).toBe("Status: Cancelled");
    // The page itself is asked for again, so the verdict follows.
    expect(refresh).toHaveBeenCalled();
  });

  it("is the only live region for status", () => {
    const { container } = renderHero("running");
    expect(container.querySelectorAll('[aria-live], [role="status"]')).toHaveLength(1);
  });
});

describe("the Delete button", () => {
  it("opens the delete dialog, and leaves the page usable and focus on the button when it closes", async () => {
    renderHero("failed:timeout");
    const trigger = screen.getByRole("button", { name: "Delete simulation" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(await screen.findByText("Delete this simulation?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.queryByText("Delete this simulation?")).toBeNull());

    expect(document.body.style.pointerEvents).not.toBe("none");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
