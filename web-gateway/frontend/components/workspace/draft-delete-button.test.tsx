import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Job, JobStatus } from "@/lib/jobs/types";

const { deleteDraft, toast, refresh } = vi.hoisted(() => ({
  deleteDraft: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  refresh: vi.fn(),
}));
vi.mock("@/lib/jobs/actions", () => ({ cancelJob: vi.fn(), deleteDraft }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  usePathname: () => "/workspace",
}));

import { DraftDeleteButton } from "@/components/workspace/draft-delete-button";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.removeAttribute("style");
});

function job(status: JobStatus, over: Partial<Job> = {}): Job {
  return {
    id: "j1",
    status,
    cancel_requested_at: null,
    work_dir: "/anvil/scratch/u/run-1",
    remote_job_dir: "/anvil/scratch/u/jobs/j1",
    files: null,
    ...over,
  } as Job;
}

function setup(status: JobStatus, over: Partial<Job> = {}) {
  const onSessionExpired = vi.fn();
  const view = render(
    <DraftDeleteButton job={job(status, over)} name="Run one" onSessionExpired={onSessionExpired} />
  );
  return { onSessionExpired, view };
}

describe("the row delete button", () => {
  it("is a 40 px icon button named for its row", () => {
    setup("COMPLETED");
    const button = screen.getByRole("button", { name: "Delete snapshot draft Run one" });
    expect(button.className).toContain("size-10");
    expect(button.className).toContain("hover:text-destructive");
  });

  it("says draft in its name for a draft", () => {
    setup("DRAFT");
    expect(screen.getByRole("button", { name: "Delete snapshot draft Run one" })).toBeTruthy();
  });

  it.each<JobStatus>(["DRAFT", "COMPLETED", "FAILED", "CANCELLED"])("is offered for %s", (status) => {
    setup(status);
    expect(screen.getByRole("button", { name: /^Delete/ })).toBeTruthy();
  });

  it.each<JobStatus>(["PENDING", "SUBMITTED", "RUNNING", "COMPLETING"])(
    "is not offered for %s, and leaves a placeholder of the same size",
    (status) => {
      const { view } = setup(status);
      expect(screen.queryByRole("button")).toBeNull();
      const placeholder = view.container.querySelector("span[aria-hidden]");
      expect(placeholder?.className).toContain("size-10");
    }
  );

  it("offers no dropdown menu and no Open or Cancel", () => {
    setup("RUNNING");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByText("Cancel run")).toBeNull();
  });

  it("opens the confirmation for a draft, which names nothing on Anvil", async () => {
    setup("DRAFT");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete snapshot draft Run one" }));
    await screen.findByText("Delete this snapshot draft?");
  });

  it("names the directories a finished snapshot draft's delete removes", async () => {
    setup("COMPLETED");
    fireEvent.click(screen.getByRole("button", { name: "Delete snapshot draft Run one" }));

    await screen.findByText("Delete this snapshot draft?");
    expect(screen.getByText("/anvil/scratch/u/run-1")).toBeTruthy();
    expect(screen.getByText("/anvil/scratch/u/jobs/j1")).toBeTruthy();
  });

  it("deletes through the dialog, then refreshes instead of leaving the list", async () => {
    deleteDraft.mockResolvedValue({ ok: true, data: null });
    setup("DRAFT");
    fireEvent.click(screen.getByRole("button", { name: "Delete snapshot draft Run one" }));

    await screen.findByText("Delete this snapshot draft?");
    fireEvent.click(screen.getByRole("button", { name: "Delete snapshot draft" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(deleteDraft).toHaveBeenCalledWith("j1");
  });

  it("reports an ended session to the list, and does not refresh", async () => {
    deleteDraft.mockResolvedValue({ ok: false, reason: "session_expired" });
    const { onSessionExpired } = setup("FAILED");
    fireEvent.click(screen.getByRole("button", { name: "Delete snapshot draft Run one" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Delete snapshot draft" }));

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("leaves the page clickable and focus on the button after the dialog is dismissed", async () => {
    setup("COMPLETED");
    const button = screen.getByRole("button", { name: "Delete snapshot draft Run one" });
    button.focus();
    fireEvent.click(button);
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(deleteDraft).not.toHaveBeenCalled();
    expect(document.body.style.pointerEvents).not.toBe("none");
    await waitFor(() => expect(document.activeElement).toBe(button));
  });
});
