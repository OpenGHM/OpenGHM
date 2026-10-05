import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JobStatusResponse } from "@/lib/jobs/types";

const { cancelJob, toast } = vi.hoisted(() => ({
  cancelJob: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/jobs/actions", () => ({ cancelJob }));
vi.mock("sonner", () => ({ toast }));

import { CancelJobDialog } from "@/components/workspace/cancel-job-dialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const STATUS = { status: "CANCELLED" } as JobStatusResponse;

function setup(over: Partial<React.ComponentProps<typeof CancelJobDialog>> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    jobId: "j1",
    onCancelled: vi.fn(),
    onConflict: vi.fn(),
    onSessionExpired: vi.fn(),
    onPendingChange: vi.fn(),
    ...over,
  };
  render(<CancelJobDialog {...props} />);
  return props;
}

describe("the cancel dialog", () => {
  it("says what will happen when open, and nothing when closed", () => {
    const { rerender } = render(
      <CancelJobDialog open onOpenChange={vi.fn()} jobId="j1" onCancelled={vi.fn()} />
    );
    expect(screen.getByText("Cancel this run?")).toBeTruthy();
    expect(screen.getByText(/the work so far is kept until you delete it/)).toBeTruthy();
    rerender(<CancelJobDialog open={false} onOpenChange={vi.fn()} jobId="j1" onCancelled={vi.fn()} />);
    expect(screen.queryByText("Cancel this run?")).toBeNull();
  });

  it("cancels the job on confirm, closes, and hands the new status to the caller", async () => {
    cancelJob.mockResolvedValue({ ok: true, data: STATUS });
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    await waitFor(() => expect(props.onCancelled).toHaveBeenCalledWith(STATUS));
    expect(cancelJob).toHaveBeenCalledWith("j1");
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalledWith("Run cancelled.");
  });

  it("stays open while the request is in flight", async () => {
    let answer: (value: unknown) => void = () => {};
    cancelJob.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));

    await screen.findByRole("button", { name: "Cancelling…" });
    expect(props.onPendingChange).toHaveBeenLastCalledWith(true);
    expect((screen.getByRole("button", { name: "Keep running" }) as HTMLButtonElement).disabled).toBe(true);
    // Escape must not close it.
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(props.onOpenChange).not.toHaveBeenCalled();

    answer({ ok: true, data: STATUS });
    await waitFor(() => expect(props.onPendingChange).toHaveBeenLastCalledWith(false));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("asks the caller to look again after a 409", async () => {
    cancelJob.mockResolvedValue({ ok: false, reason: "error", message: "Already ended", status: 409 });
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    await waitFor(() => expect(props.onConflict).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith("Already ended");
    expect(props.onCancelled).not.toHaveBeenCalled();
  });

  it("reports an expired session to the caller", async () => {
    cancelJob.mockResolvedValue({ ok: false, reason: "session_expired" });
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    await waitFor(() => expect(props.onSessionExpired).toHaveBeenCalled());
  });

  it("does not call the backend for preview data", () => {
    const props = setup({ preview: true });
    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    expect(cancelJob).not.toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.info).toHaveBeenCalled();
  });
});
