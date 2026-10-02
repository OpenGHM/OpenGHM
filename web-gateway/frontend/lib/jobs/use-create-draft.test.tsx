import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ActionResult, Job } from "@/lib/jobs/types";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/jobs/actions", () => ({ deriveSimulation: vi.fn(), duplicateSimulation: vi.fn() }));

import { deriveSimulation, duplicateSimulation } from "@/lib/jobs/actions";
import { useCreateDraft } from "@/lib/jobs/use-create-draft";
import { fakeSimulation } from "@/lib/workspace/fixtures";

const derive = vi.mocked(deriveSimulation);
const duplicate = vi.mocked(duplicateSimulation);

const created = fakeSimulation("DRAFT", { id: "new-draft" });
const ok: ActionResult<Job> = { ok: true, data: created };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  push.mockReset();
  derive.mockReset();
  duplicate.mockReset();
});
afterEach(cleanup);

describe("useCreateDraft", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => useCreateDraft());
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("deriveFrom creates from the snapshot and opens the new draft at its first step", async () => {
    derive.mockResolvedValue(ok);
    const { result } = renderHook(() => useCreateDraft());
    await act(async () => result.current.deriveFrom("snap-1"));
    expect(derive).toHaveBeenCalledWith("snap-1");
    expect(duplicate).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/workspace/new-draft?step=model");
    expect(result.current.error).toBeNull();
  });

  it("duplicateFrom creates from the simulation and opens the new draft at its first step", async () => {
    duplicate.mockResolvedValue(ok);
    const { result } = renderHook(() => useCreateDraft());
    await act(async () => result.current.duplicateFrom("job-1"));
    expect(duplicate).toHaveBeenCalledWith("job-1");
    expect(derive).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/workspace/new-draft?step=model");
  });

  it("is pending while the request is out, and stays so after a success so a second click cannot make a second draft", async () => {
    const answer = deferred<ActionResult<Job>>();
    derive.mockReturnValue(answer.promise);
    const { result } = renderHook(() => useCreateDraft());

    act(() => void result.current.deriveFrom("snap-1"));
    expect(result.current.pending).toBe(true);

    await act(async () => answer.resolve(ok));
    expect(push).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(true);

    await act(async () => result.current.deriveFrom("snap-1"));
    expect(derive).toHaveBeenCalledTimes(1);
  });

  it("ignores a second call while one is pending, even in the same tick and from the other path", async () => {
    const answer = deferred<ActionResult<Job>>();
    derive.mockReturnValue(answer.promise);
    const { result } = renderHook(() => useCreateDraft());

    act(() => {
      void result.current.deriveFrom("snap-1");
      void result.current.deriveFrom("snap-1");
      void result.current.duplicateFrom("job-1");
    });
    await act(async () => answer.resolve(ok));

    expect(derive).toHaveBeenCalledTimes(1);
    expect(duplicate).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("returns an ended session in state, and can be tried again", async () => {
    derive.mockResolvedValueOnce({ ok: false, reason: "session_expired" });
    const { result } = renderHook(() => useCreateDraft());
    await act(async () => result.current.deriveFrom("snap-1"));
    expect(result.current.error).toEqual({ kind: "session-expired" });
    expect(result.current.pending).toBe(false);
    expect(push).not.toHaveBeenCalled();

    derive.mockResolvedValueOnce(ok);
    await act(async () => result.current.deriveFrom("snap-1"));
    expect(result.current.error).toBeNull();
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("returns the backend's message and code, e.g. a snapshot that is gone", async () => {
    duplicate.mockResolvedValue({
      ok: false,
      reason: "error",
      message: "The model snapshot is no longer in the repository.",
      code: "snapshot_not_found",
      status: 422,
    });
    const { result } = renderHook(() => useCreateDraft());
    await act(async () => result.current.duplicateFrom("job-1"));
    expect(result.current.error).toEqual({
      kind: "error",
      message: "The model snapshot is no longer in the repository.",
      code: "snapshot_not_found",
    });
    expect(result.current.pending).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("says what is missing when the source is not found", async () => {
    derive.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    duplicate.mockResolvedValueOnce({ ok: false, reason: "not_found" });
    const { result } = renderHook(() => useCreateDraft());
    await act(async () => result.current.deriveFrom("snap-1"));
    expect(result.current.error).toEqual({ kind: "error", message: "That model snapshot is no longer in the repository." });
    await act(async () => result.current.duplicateFrom("job-1"));
    expect(result.current.error).toEqual({ kind: "error", message: "That simulation no longer exists." });
  });

  it("returns a thrown error in state instead of throwing", async () => {
    derive.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useCreateDraft());
    await act(async () => result.current.deriveFrom("snap-1"));
    expect(result.current.error).toEqual({ kind: "error", message: "network down" });
    expect(result.current.pending).toBe(false);
  });

  it("clears the last error when it starts again", async () => {
    derive.mockResolvedValueOnce({ ok: false, reason: "error", message: "boom" });
    const { result } = renderHook(() => useCreateDraft());
    await act(async () => result.current.deriveFrom("snap-1"));
    expect(result.current.error).not.toBeNull();

    const answer = deferred<ActionResult<Job>>();
    derive.mockReturnValueOnce(answer.promise);
    act(() => void result.current.deriveFrom("snap-1"));
    expect(result.current.error).toBeNull();
    await act(async () => answer.resolve(ok));
  });
});
