import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ActionResult, Job } from "@/lib/jobs/types";

const { push, toastError } = vi.hoisted(() => ({ push: vi.fn(), toastError: vi.fn() }));
vi.mock("@/lib/jobs/actions", () => ({ deriveDraft: vi.fn(), duplicateDraft: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/workspace/job-1",
}));

import { DuplicateDraftButton } from "@/components/workspace/duplicate-draft-button";
import { deriveDraft, duplicateDraft } from "@/lib/jobs/actions";
import { fakeDraft } from "@/lib/workspace/fixtures";

const duplicate = vi.mocked(duplicateDraft);
const derive = vi.mocked(deriveDraft);
const copy: ActionResult<Job> = { ok: true, data: fakeDraft("DRAFT", { id: "copy-1" }) };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const button = () => screen.getByRole("button", { name: "Try again with these settings" }) as HTMLButtonElement;

beforeEach(() => {
  push.mockReset();
  toastError.mockReset();
  duplicate.mockReset();
  derive.mockReset();
});
afterEach(cleanup);

describe("DuplicateDraftButton", () => {
  it("says what it does under the button", () => {
    render(<DuplicateDraftButton jobId="job-1" />);
    const note = screen.getByText(/Copies this snapshot draft's run settings into a new draft/);
    expect(button().getAttribute("aria-describedby")).toBe(note.id);
  });

  it("duplicates the snapshot draft, not the snapshot, and opens the copy at its first step", async () => {
    duplicate.mockResolvedValue(copy);
    render(<DuplicateDraftButton jobId="job-1" />);
    await act(async () => fireEvent.click(button()));
    expect(duplicate).toHaveBeenCalledWith("job-1");
    expect(derive).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/workspace/copy-1?step=run");
  });

  it("is off while the request is out and after it succeeds, so a double click makes one copy", async () => {
    const answer = deferred<ActionResult<Job>>();
    duplicate.mockReturnValue(answer.promise);
    render(<DuplicateDraftButton jobId="job-1" />);

    act(() => {
      fireEvent.click(button());
    });
    expect(button().disabled).toBe(true);
    fireEvent.click(button());

    await act(async () => answer.resolve(copy));
    expect(button().disabled).toBe(true);
    fireEvent.click(button());
    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("says plainly that a snapshot that has left the repository cannot be copied, and lets the user retry", async () => {
    duplicate.mockResolvedValue({
      ok: false,
      reason: "error",
      status: 422,
      code: "snapshot_not_found",
      message: "The model snapshot this snapshot draft is based on is no longer in the repository, so it can't be copied.",
    } as ActionResult<Job>);
    render(<DuplicateDraftButton jobId="job-1" />);
    await act(async () => fireEvent.click(button()));

    const message = "This snapshot draft's model snapshot is no longer in the repository, so it can't be copied.";
    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(toastError).toHaveBeenCalledWith(message);
    expect(push).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
  });

  it("shows another failure's own message", async () => {
    duplicate.mockResolvedValue({ ok: false, reason: "error", message: "Boom" } as ActionResult<Job>);
    render(<DuplicateDraftButton jobId="job-1" />);
    await act(async () => fireEvent.click(button()));
    expect(screen.getByRole("alert").textContent).toBe("Boom");
    expect(toastError).toHaveBeenCalledWith("Boom");
  });

  it("shows the sign-in banner when the session has expired", async () => {
    duplicate.mockResolvedValue({ ok: false, reason: "session_expired" } as ActionResult<Job>);
    render(<DuplicateDraftButton jobId="job-1" />);
    await act(async () => fireEvent.click(button()));
    expect(screen.getByRole("link", { name: /sign in/i })).toBeTruthy();
    expect(toastError).toHaveBeenCalledWith("Your session has expired.");
    expect(button().disabled).toBe(false);
  });
});
