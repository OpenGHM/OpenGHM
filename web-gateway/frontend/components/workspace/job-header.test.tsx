import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JobStatus, JobStatusResponse } from "@/lib/jobs/types";

const { pollJobStatus, refresh, push, duplicateDraft } = vi.hoisted(() => ({
  pollJobStatus: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  duplicateDraft: vi.fn(),
}));
vi.mock("@/lib/jobs/actions", () => ({
  pollJobStatus,
  cancelJob: vi.fn(),
  deleteDraft: vi.fn(),
  deriveDraft: vi.fn(),
  duplicateDraft,
  submitDraft: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => "/workspace/x",
}));

import { JobHeader } from "@/components/workspace/job-header";
import { LiveJobProvider } from "@/components/workspace/live-job-provider";
import { fakeDraft, previewDraftJob } from "@/lib/workspace/fixtures";

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
  push.mockReset();
  duplicateDraft.mockReset();
});
afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = "";
});

function renderHeader(key: string, { preview = true }: { preview?: boolean } = {}) {
  const job = previewDraftJob(key);
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
      <JobHeader job={job} preview={preview} />
    </LiveJobProvider>
  );
}

const button = (name: string) => screen.queryByRole("button", { name });
/** A button-styled link: it only opens the new-snapshot draft wizard, so it is a link. */
const startLink = (name: string) => screen.queryByRole("link", { name });

describe("the header", () => {
  it("has no actions while the job is active: Cancel is in the status summary", () => {
    for (const key of ["pending", "submitted", "running", "completing", "cancelling"]) {
      renderHeader(key);
      expect(button("Cancel")).toBeNull();
      expect(button("Duplicate")).toBeNull();
      expect(startLink("New from this model snapshot")).toBeNull();
      expect(button("Delete snapshot draft")).toBeNull();
      cleanup();
    }
  });

  it.each(["completed", "failed:timeout", "cancelled:user"])(
    "shows New from this model snapshot (a link to the new-snapshot draft wizard) and Delete, once %s",
    (key) => {
      renderHeader(key);
      expect(startLink("New from this model snapshot")).not.toBeNull();
      expect(button("Delete snapshot draft")).not.toBeNull();
      expect(screen.queryByRole("menu")).toBeNull();
      expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
      expect(button("Cancel")).toBeNull();
    }
  );

  it.each(["completed", "failed:timeout", "cancelled:user"])(
    "does not repeat the retry the status summary has, once %s",
    (key) => {
      renderHeader(key);
      expect(button("Try again with these settings")).toBeNull();
    }
  );

  it("offers Duplicate in the header of a completed job, which has no copy action in its summary", () => {
    renderHeader("completed");
    const duplicate = button("Duplicate");
    expect(duplicate).not.toBeNull();
    expect(duplicate?.getAttribute("data-variant")).toBe("outline");
    expect(button("Try again with these settings")).toBeNull();
  });

  it.each(["failed:timeout", "failed:wbm_error", "cancelled:user"])(
    "leaves the copy action of a job that is %s to its status summary: no Duplicate in the header",
    (key) => {
      renderHeader(key);
      expect(button("Duplicate")).toBeNull();
    }
  );

  it("copies the snapshot draft into a new draft when Duplicate is pressed", async () => {
    duplicateDraft.mockResolvedValue({ ok: true, data: fakeDraft("DRAFT", { id: "copy-1" }) });
    renderHeader("completed");
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/workspace/copy-1?step=run"));
    expect(duplicateDraft).toHaveBeenCalledWith(previewDraftJob("completed").id);
  });

  it("titles the page with the snapshot draft's name, with the status beside it and the snapshot under it", () => {
    renderHeader("running");
    const job = previewDraftJob("running");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(job.sim_id);
    expect(screen.getByText("Running")).toBeTruthy();
    const link = screen.getByRole("link", { name: `Based on ${job.dataset_title}` });
    expect(link.getAttribute("href")).toBe(`/repository/${job.dataset_id}`);
    expect(link.getAttribute("title")).toBe(job.dataset_title);
    expect(screen.queryByText(`Slurm #${job.slurm_job_id}`)).toBeTruthy();
  });

  it("titles it with the name its owner gave it, and keeps the run id in the small line", () => {
    const job = previewDraftJob("completed", { overrides: { about: { name: "My CONUS run" } } });
    render(
      <LiveJobProvider jobId={job.id} initialStatus={job.status} initialData={{}} preview>
        <JobHeader job={job} preview />
      </LiveJobProvider>
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("My CONUS run");
    expect(screen.getByText(new RegExp(job.sim_id))).toBeTruthy();
  });

  it("says which snapshot it is based on by its title, cut to one line with the whole title on hover", () => {
    const title = "WBM v1.0.0 Global_tracking snapshot draft for 'Water balance model (WBM) v.1.0.0': [Global] [2000-2009]";
    const job = previewDraftJob("completed", { overrides: { dataset_title: title } });
    render(
      <LiveJobProvider jobId={job.id} initialStatus={job.status} initialData={{}} preview>
        <JobHeader job={job} preview />
      </LiveJobProvider>
    );
    const link = screen.getByRole("link", { name: `Based on ${title}` });
    expect(link.getAttribute("href")).toBe(`/repository/${job.dataset_id}`);
    expect(link.getAttribute("title")).toBe(title);
    expect(link.className).toContain("truncate");
  });

  it("is a light header like the repository's: no dark gradient, nothing white, a normal Delete button", () => {
    const { container } = renderHeader("completed");
    expect(container.innerHTML).not.toContain("gradient");
    expect(container.innerHTML).not.toContain("text-white");
    const del = screen.getByRole("button", { name: "Delete snapshot draft" });
    expect(del.className).toContain("text-destructive");
    expect(screen.getByRole("link", { name: "New from this model snapshot" }).getAttribute("data-variant")).toBe("outline");
  });

  it("has the breadcrumb in the header", () => {
    renderHeader("completed");
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav.querySelector("a")?.getAttribute("href")).toBe("/workspace");
    expect(screen.queryByText("Back to snapshot drafts")).toBeNull();
  });
});

function answer(status: JobStatus): JobStatusResponse {
  const job = previewDraftJob("running");
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
    renderHeader("running", { preview: false });

    // First render: no buttons, and nothing announced.
    expect(button("Delete snapshot draft")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");

    await waitFor(() => expect(button("Delete snapshot draft")).not.toBeNull());
    expect(screen.getByRole("status").textContent).toBe("Status: Cancelled");
    // The page itself is asked for again, so the verdict follows.
    expect(refresh).toHaveBeenCalled();
  });

  it("is the only live region for status", () => {
    const { container } = renderHeader("running");
    expect(container.querySelectorAll('[aria-live], [role="status"]')).toHaveLength(1);
  });
});

describe("the Delete button", () => {
  it("opens the delete dialog, and leaves the page usable and focus on the button when it closes", async () => {
    renderHeader("failed:timeout");
    const trigger = screen.getByRole("button", { name: "Delete snapshot draft" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(await screen.findByText("Delete this snapshot draft?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.queryByText("Delete this snapshot draft?")).toBeNull());

    expect(document.body.style.pointerEvents).not.toBe("none");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
