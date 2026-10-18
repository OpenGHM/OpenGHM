import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { deleteDraft, toast, push } = vi.hoisted(() => ({
  deleteDraft: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  push: vi.fn(),
}));
vi.mock("@/lib/jobs/actions", () => ({ deleteDraft }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { DeleteDraftDialog } from "@/components/workspace/delete-draft-dialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup(over: Partial<React.ComponentProps<typeof DeleteDraftDialog>> = {}) {
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
  render(<DeleteDraftDialog {...props} />);
  return props;
}

describe("the delete dialog", () => {
  it("shows the unreachable-backend sentence, and tells the caller the snapshot draft still exists", async () => {
    const message = "The gateway's server could not be reached. Nothing was changed; try again in a minute.";
    deleteDraft.mockResolvedValue({ ok: false, reason: "error", message, code: "backend_unreachable" });
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete snapshot draft" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect(props.onError).toHaveBeenCalledWith(message);
    expect(push).not.toHaveBeenCalled();
  });

  it("says a fixed sentence when the request itself throws, never the exception's text", async () => {
    deleteDraft.mockRejectedValue(new Error("fetch failed: ECONNRESET"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete snapshot draft" }));
    const message = "Could not confirm the delete. The snapshot draft may still exist.";
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect(props.onError).toHaveBeenCalledWith(message);
  });

  it("lists the directories that go for a finished job", () => {
    setup({ files: "purged" });
    expect(screen.getByText("Delete this snapshot draft?")).toBeTruthy();
    expect(screen.getByText("/anvil/scratch/u/run-1")).toBeTruthy();
    expect(screen.getByText("/anvil/scratch/u/jobs/j1")).toBeTruthy();
    expect(screen.getByText(/purge already removed it/)).toBeTruthy();
    expect(screen.getByText("This can't be undone.")).toBeTruthy();
  });

  it("says a draft is only removed", () => {
    setup({ isDraft: true, workDir: null, remoteJobDir: null });
    expect(screen.getByText("Delete this snapshot draft?")).toBeTruthy();
    expect(screen.getByText("This snapshot draft is removed.")).toBeTruthy();
    expect(screen.queryByText(/directories on Anvil/)).toBeNull();
  });

  it("renders nothing when closed", () => {
    setup({ open: false });
    expect(screen.queryByText("Delete this snapshot draft?")).toBeNull();
  });

  it("deletes on confirm and goes to the list", async () => {
    deleteDraft.mockResolvedValue({ ok: true, data: null });
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete snapshot draft" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/workspace"));
    expect(deleteDraft).toHaveBeenCalledWith("j1");
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith("Snapshot draft deleted.");
  });

  it("calls onDeleted instead of going to the list when the caller passes it", async () => {
    deleteDraft.mockResolvedValue({ ok: true, data: null });
    const onDeleted = vi.fn();
    setup({ onDeleted });
    fireEvent.click(screen.getByRole("button", { name: "Delete snapshot draft" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it("tells onDeleted before it closes, so a caller can tell a delete from a cancel", async () => {
    deleteDraft.mockResolvedValue({ ok: true, data: null });
    const order: string[] = [];
    const onDeleted = vi.fn(() => void order.push("deleted"));
    const onOpenChange = vi.fn((open: boolean) => void order.push(`open:${open}`));
    setup({ onDeleted, onOpenChange });
    fireEvent.click(screen.getByRole("button", { name: "Delete snapshot draft" }));
    await waitFor(() => expect(order).toEqual(["deleted", "open:false"]));
  });

  it("stays open while the request is in flight", async () => {
    let answer: (value: unknown) => void = () => {};
    deleteDraft.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete snapshot draft" }));

    await screen.findByRole("button", { name: "Deleting…" });
    expect((screen.getByRole("button", { name: "Keep it" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(props.onOpenChange).not.toHaveBeenCalled();

    answer({ ok: true, data: null });
    await waitFor(() => expect(props.onOpenChange).toHaveBeenCalledWith(false));
  });

  it("keeps the snapshot draft and reports the backend's reason on failure", async () => {
    deleteDraft.mockResolvedValue({ ok: false, reason: "error", message: "Anvil is unreachable." });
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete snapshot draft" }));
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith("Anvil is unreachable."));
    expect(push).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Anvil is unreachable.");
  });

  it("reports an expired session to the caller", async () => {
    deleteDraft.mockResolvedValue({ ok: false, reason: "session_expired" });
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Delete snapshot draft" }));
    await waitFor(() => expect(props.onSessionExpired).toHaveBeenCalled());
  });
});
