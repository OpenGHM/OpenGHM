import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { deleteSimulation, toast, push } = vi.hoisted(() => ({
  deleteSimulation: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  push: vi.fn(),
}));
vi.mock("@/lib/jobs/actions", () => ({ deleteSimulation }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { DeleteSimulationDialog } from "@/components/workspace/delete-simulation-dialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup(over: Partial<React.ComponentProps<typeof DeleteSimulationDialog>> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    jobId: "j1",
    isDraft: false,
    workDir: "/anvil/scratch/u/run-1",
    remoteJobDir: "/anvil/scratch/u/jobs/j1",
    files: null,
    onSessionExpired: vi.fn(),
    onError: vi.fn(),
    ...over,
  };
  render(<DeleteSimulationDialog {...props} />);
  return props;
}

describe("the delete dialog", () => {
  it("lists the directories that go for a finished job", () => {
    setup({ files: "purged" });
    expect(screen.getByText("Delete this simulation?")).toBeTruthy();
    expect(screen.getByText("/anvil/scratch/u/run-1")).toBeTruthy();
    expect(screen.getByText("/anvil/scratch/u/jobs/j1")).toBeTruthy();
    expect(screen.getByText(/purge already removed it/)).toBeTruthy();
    expect(screen.getByText("This can't be undone.")).toBeTruthy();
  });

  it("says a draft is only removed", () => {
    setup({ isDraft: true, workDir: null, remoteJobDir: null });
    expect(screen.getByText("Delete this draft?")).toBeTruthy();
    expect(screen.getByText("This draft is removed.")).toBeTruthy();
    expect(screen.queryByText(/directories on Anvil/)).toBeNull();
  });

  it("renders nothing when closed", () => {
    setup({ open: false });
    expect(screen.queryByText("Delete this simulation?")).toBeNull();
  });

  it("deletes on confirm and goes to the list", async () => {
    deleteSimulation.mockResolvedValue({ ok: true, data: null });
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete simulation" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/workspace"));
    expect(deleteSimulation).toHaveBeenCalledWith("j1");
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith("Simulation deleted.");
  });

  it("calls onDeleted instead of going to the list when the caller passes it", async () => {
    deleteSimulation.mockResolvedValue({ ok: true, data: null });
    const onDeleted = vi.fn();
    setup({ onDeleted });
    fireEvent.click(screen.getByRole("button", { name: "Delete simulation" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it("tells onDeleted before it closes, so a caller can tell a delete from a cancel", async () => {
    deleteSimulation.mockResolvedValue({ ok: true, data: null });
    const order: string[] = [];
    const onDeleted = vi.fn(() => void order.push("deleted"));
    const onOpenChange = vi.fn((open: boolean) => void order.push(`open:${open}`));
    setup({ onDeleted, onOpenChange });
    fireEvent.click(screen.getByRole("button", { name: "Delete simulation" }));
    await waitFor(() => expect(order).toEqual(["deleted", "open:false"]));
  });

  it("stays open while the request is in flight", async () => {
    let answer: (value: unknown) => void = () => {};
    deleteSimulation.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete simulation" }));

    await screen.findByRole("button", { name: "Deleting…" });
    expect((screen.getByRole("button", { name: "Keep it" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(props.onOpenChange).not.toHaveBeenCalled();

    answer({ ok: true, data: null });
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  });

  it("keeps the simulation and reports the backend's reason on failure", async () => {
    deleteSimulation.mockResolvedValue({ ok: false, reason: "error", message: "Anvil is unreachable." });
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete simulation" }));
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith("Anvil is unreachable."));
    expect(push).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Anvil is unreachable.");
  });

  it("reports an expired session to the caller", async () => {
    deleteSimulation.mockResolvedValue({ ok: false, reason: "session_expired" });
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete simulation" }));
    await waitFor(() => expect(props.onSessionExpired).toHaveBeenCalled());
  });
});
