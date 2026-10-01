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

function renderHero(key: string, { blockedReason = null, preview = true }: { blockedReason?: string | null; preview?: boolean } = {}) {
  const job = previewSimulation(key);
  const hero = (
    <JobHero job={job} recommended={null} blockedReason={blockedReason} preview={preview} />
  );
  if (job.status === "DRAFT") return render(hero);
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
      {hero}
    </LiveJobProvider>
  );
}

const button = (name: string) => screen.queryByRole("button", { name });

describe("the header actions by status", () => {
  it("offers Submit and the More menu for a draft, and no Cancel", () => {
    renderHero("draft");
    expect((button("Submit to Anvil") as HTMLButtonElement).disabled).toBe(false);
    expect(button("More actions")).not.toBeNull();
    expect(button("Cancel")).toBeNull();
    expect(button("New from this model snapshot")).toBeNull();
  });

  it("disables Submit for a blocked user and says why, in text and in a tooltip", async () => {
    const reason = "Your account has not been approved to run simulations.";
    renderHero("draft", { blockedReason: reason });
    const submit = button("Submit to Anvil") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute("aria-describedby")).toBe(screen.getByText(reason).closest("p")!.id);
    // The tooltip hangs on the focusable span around the disabled button.
    fireEvent.focus(submit.parentElement!);
    await waitFor(() => expect(screen.getByRole("tooltip").textContent).toContain(reason));
  });

  it.each(["pending", "submitted", "running"])("offers only Cancel while %s", (key) => {
    renderHero(key);
    expect(button("Cancel")).not.toBeNull();
    expect(button("More actions")).toBeNull();
    expect(button("New from this model snapshot")).toBeNull();
    expect(button("Submit to Anvil")).toBeNull();
  });

  it("offers nothing while COMPLETING", () => {
    renderHero("completing");
    expect(button("Cancel")).toBeNull();
    expect(button("More actions")).toBeNull();
    expect(button("New from this model snapshot")).toBeNull();
  });

  it("offers nothing once a cancel is waiting on SLURM", () => {
    renderHero("cancelling");
    expect(screen.getByText("Cancelling")).toBeTruthy();
    expect(button("Cancel")).toBeNull();
    expect(button("More actions")).toBeNull();
  });

  it.each(["completed", "failed:timeout", "cancelled:user"])(
    "offers a new simulation and the More menu when %s",
    (key) => {
      renderHero(key);
      expect(button("New from this model snapshot")).not.toBeNull();
      expect(button("More actions")).not.toBeNull();
      expect(button("Cancel")).toBeNull();
    }
  );

  it("shows the status next to the title, and a link to the base model snapshot", () => {
    renderHero("running");
    const job = previewSimulation("running");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(job.dataset_title);
    expect(screen.getByText("Running")).toBeTruthy();
    const link = screen.getByRole("link", { name: `Base model snapshot: ${job.dataset_title}` });
    expect(link.getAttribute("href")).toBe(`/repository/${job.dataset_id}`);
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
  it("swaps Cancel for the ended actions and announces it, without a reload", async () => {
    pollJobStatus.mockResolvedValue({ ok: true, data: answer("CANCELLED") });
    renderHero("running", { preview: false });

    // First render: Cancel, and nothing announced.
    expect(button("Cancel")).not.toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");

    await waitFor(() => expect(button("New from this model snapshot")).not.toBeNull());
    expect(button("Cancel")).toBeNull();
    expect(button("More actions")).not.toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Status: Cancelled");
    // The page itself is asked for again, so the verdict cards follow.
    expect(refresh).toHaveBeenCalled();
  });

  it("is the only live region for status", () => {
    const { container } = renderHero("running");
    expect(container.querySelectorAll('[aria-live], [role="status"]')).toHaveLength(1);
  });
});

describe("the More menu", () => {
  it("opens the delete dialog, and leaves the page usable and focus on the trigger when it closes", async () => {
    renderHero("failed:timeout");
    const trigger = screen.getByRole("button", { name: "More actions" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });

    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete simulation" }));
    expect(await screen.findByText("Delete this simulation?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.queryByText("Delete this simulation?")).toBeNull());

    expect(document.body.style.pointerEvents).not.toBe("none");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("says draft for a draft", async () => {
    renderHero("draft");
    fireEvent.keyDown(screen.getByRole("button", { name: "More actions" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete draft" }));
    expect(await screen.findByText("Delete this draft?")).toBeTruthy();
  });
});
