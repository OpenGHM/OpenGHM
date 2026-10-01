import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Job, JobStatus } from "@/lib/jobs/types";

const { cancelJob, deleteSimulation, toast, refresh } = vi.hoisted(() => ({
  cancelJob: vi.fn(),
  deleteSimulation: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  refresh: vi.fn(),
}));
vi.mock("@/lib/jobs/actions", () => ({ cancelJob, deleteSimulation }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  usePathname: () => "/workspace",
}));

import { SimulationRowActions } from "@/components/workspace/simulation-row-actions";

// jsdom has none of what Radix's menu measures and scrolls with.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

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
  render(<SimulationRowActions job={job(status, over)} name="Run one" onSessionExpired={onSessionExpired} />);
  return { onSessionExpired };
}

function openMenu() {
  const trigger = screen.getByRole("button", { name: "Actions for Run one" });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  return trigger;
}

function items(): string[] {
  return screen.getAllByRole("menuitem").map((el) => el.textContent ?? "");
}

describe("the row menu", () => {
  it("is a 40 px icon button named for its row", () => {
    setup("RUNNING");
    const trigger = screen.getByRole("button", { name: "Actions for Run one" });
    expect(trigger.className).toContain("size-10");
  });

  it.each<[JobStatus, string[]]>([
    ["DRAFT", ["Open", "Delete draft"]],
    ["PENDING", ["Open", "Cancel simulation"]],
    ["SUBMITTED", ["Open", "Cancel simulation"]],
    ["RUNNING", ["Open", "Cancel simulation"]],
    ["COMPLETING", ["Open"]],
    ["COMPLETED", ["Open", "Delete simulation"]],
    ["FAILED", ["Open", "Delete simulation"]],
    ["CANCELLED", ["Open", "Delete simulation"]],
  ])("offers for %s: %j", (status, expected) => {
    setup(status);
    openMenu();
    expect(items()).toEqual(expected);
  });

  it("does not offer Cancel again once a cancel is waiting on SLURM", () => {
    setup("RUNNING", { cancel_requested_at: "2026-09-30T12:00:00Z" });
    openMenu();
    expect(items()).toEqual(["Open"]);
  });

  it("opens the simulation from Open", () => {
    setup("RUNNING");
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Open" }).getAttribute("href")).toBe("/workspace/j1");
  });

  it("cancels through the dialog, then refreshes the list", async () => {
    cancelJob.mockResolvedValue({ ok: true, data: { status: "CANCELLED" } });
    setup("RUNNING");
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Cancel simulation" }));

    await screen.findByRole("alertdialog");
    // The menu has closed by the time the dialog is up.
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel simulation" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(cancelJob).toHaveBeenCalledWith("j1");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("deletes a draft through the dialog, then refreshes instead of leaving the list", async () => {
    deleteSimulation.mockResolvedValue({ ok: true, data: null });
    setup("DRAFT");
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete draft" }));

    await screen.findByText("Delete this draft?");
    fireEvent.click(screen.getByRole("button", { name: "Delete draft" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(deleteSimulation).toHaveBeenCalledWith("j1");
  });

  it("names the directories a finished simulation's delete removes", async () => {
    setup("COMPLETED");
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete simulation" }));

    await screen.findByText("Delete this simulation?");
    expect(screen.getByText("/anvil/scratch/u/run-1")).toBeTruthy();
    expect(screen.getByText("/anvil/scratch/u/jobs/j1")).toBeTruthy();
  });

  it("reports an ended session to the list, and does not refresh", async () => {
    cancelJob.mockResolvedValue({ ok: false, reason: "session_expired" });
    const { onSessionExpired } = setup("RUNNING");
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Cancel simulation" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel simulation" }));

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("leaves the page clickable and focus on the button after a dialog is dismissed", async () => {
    setup("RUNNING");
    const trigger = openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Cancel simulation" }));
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getByRole("button", { name: "Keep running" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.body.style.pointerEvents).not.toBe("none");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("leaves the page clickable after the menu is closed without choosing", async () => {
    setup("RUNNING");
    openMenu();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.body.style.pointerEvents).not.toBe("none");
  });
});
