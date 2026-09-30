import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { JobStatus, JobStatusResponse } from "@/lib/jobs/types";

const pollJobStatus = vi.fn();
const refresh = vi.fn();
vi.mock("@/lib/jobs/actions", () => ({
  pollJobStatus: (...args: unknown[]) => pollJobStatus(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

import { useLiveJob } from "@/lib/workspace/use-live-job";

const answer = (status: JobStatus, live: JobStatusResponse["live"] = null): JobStatusResponse => ({
  job_id: "j1",
  sim_id: "sim-1",
  status,
  slurm_job_id: "123",
  submitted_at: "2026-09-30T12:00:00Z",
  started_at: null,
  completed_at: null,
  status_reason: null,
  work_dir: null,
  slurm_state: null,
  slurm_exit_code: null,
  slurm_start: null,
  slurm_end: null,
  failure: null,
  cancel_requested_at: null,
  cancel_requested_by_email: null,
  files: null,
  output: null,
  live,
});

const ok = (status: JobStatus) => ({ ok: true as const, data: answer(status) });
const transient = (status = 502) => ({ ok: false as const, reason: "error" as const, message: "x", status });

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  pollJobStatus.mockReset();
  refresh.mockReset();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
});

const mount = (status: JobStatus = "PENDING", disabled = false) =>
  renderHook(() => useLiveJob("j1", status, undefined, { disabled }));

describe("useLiveJob", () => {
  it("polls at once, then every 5 s while the job is not over", async () => {
    pollJobStatus.mockResolvedValue(ok("RUNNING"));
    const { result } = mount("RUNNING");
    await advance(0);
    expect(pollJobStatus).toHaveBeenCalledTimes(1);
    expect(result.current.lastSuccessAt).not.toBeNull();
    await advance(4_999);
    expect(pollJobStatus).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(pollJobStatus).toHaveBeenCalledTimes(2);
    await advance(5_000);
    expect(pollJobStatus).toHaveBeenCalledTimes(3);
  });

  it("does not poll a job that is over, or a disabled one", async () => {
    mount("COMPLETED");
    mount("RUNNING", true);
    await advance(30_000);
    expect(pollJobStatus).not.toHaveBeenCalled();
  });

  it("backs off 5, 10, 20, 40, 60 s after failures, and resets on a good answer", async () => {
    pollJobStatus.mockResolvedValue(transient());
    const { result } = mount("RUNNING");
    await advance(0);
    expect(result.current.lastError).toBe("Couldn't reach Anvil");
    expect(result.current.retryInSeconds).toBe(5);

    for (const [wait, calls] of [
      [5_000, 2],
      [10_000, 3],
      [20_000, 4],
      [40_000, 5],
      [60_000, 6],
      [60_000, 7],
    ] as const) {
      await advance(wait - 1);
      expect(pollJobStatus).toHaveBeenCalledTimes(calls - 1);
      await advance(1);
      expect(pollJobStatus).toHaveBeenCalledTimes(calls);
    }

    pollJobStatus.mockResolvedValue(ok("RUNNING"));
    await advance(60_000);
    expect(result.current.lastError).toBeNull();
    expect(result.current.retryInSeconds).toBeNull();
    const calls = pollJobStatus.mock.calls.length;
    await advance(5_000);
    expect(pollJobStatus).toHaveBeenCalledTimes(calls + 1);
  });

  it("counts the retry down each second and retries at once on demand", async () => {
    pollJobStatus.mockResolvedValue(transient());
    const { result } = mount("RUNNING");
    await advance(0);
    await advance(5_000); // second failure: next wait is 10 s
    expect(result.current.retryInSeconds).toBe(10);
    await advance(3_000);
    expect(result.current.retryInSeconds).toBe(7);
    pollJobStatus.mockResolvedValue(ok("RUNNING"));
    const before = pollJobStatus.mock.calls.length;
    await act(async () => result.current.refresh());
    expect(pollJobStatus).toHaveBeenCalledTimes(before + 1);
    expect(result.current.lastError).toBeNull();
  });

  it("stops at a terminal status, and asks Next for the page again once", async () => {
    pollJobStatus.mockResolvedValueOnce(ok("RUNNING")).mockResolvedValue(ok("COMPLETED"));
    const { result } = mount("PENDING");
    await advance(0);
    expect(refresh).toHaveBeenCalledTimes(1); // PENDING -> RUNNING
    await advance(5_000);
    expect(refresh).toHaveBeenCalledTimes(2); // RUNNING -> COMPLETED
    expect(result.current.polling).toBe(false);
    await advance(60_000);
    expect(pollJobStatus).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not refresh the page while the status is unchanged", async () => {
    pollJobStatus.mockResolvedValue(ok("PENDING"));
    mount("PENDING");
    await advance(0);
    await advance(10_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops on a 401 and on a 404", async () => {
    pollJobStatus.mockResolvedValue({ ok: false, reason: "session_expired" });
    const expired = mount("RUNNING");
    await advance(0);
    expect(expired.result.current.sessionExpired).toBe(true);
    await advance(60_000);
    expect(pollJobStatus).toHaveBeenCalledTimes(1);

    pollJobStatus.mockReset();
    pollJobStatus.mockResolvedValue({ ok: false, reason: "not_found" });
    const gone = mount("RUNNING");
    await advance(0);
    expect(gone.result.current.polling).toBe(false);
    await advance(60_000);
    expect(pollJobStatus).toHaveBeenCalledTimes(1);
  });

  it("asks nothing while the tab is hidden, and polls at once when it is shown", async () => {
    pollJobStatus.mockResolvedValue(ok("RUNNING"));
    mount("RUNNING");
    await advance(0);
    expect(pollJobStatus).toHaveBeenCalledTimes(1);

    act(() => setVisibility("hidden"));
    await advance(120_000);
    expect(pollJobStatus).toHaveBeenCalledTimes(1);

    act(() => setVisibility("visible"));
    await advance(0);
    expect(pollJobStatus).toHaveBeenCalledTimes(2);
    await advance(5_000);
    expect(pollJobStatus).toHaveBeenCalledTimes(3);
  });

  it("does not poll on show once the job is over", async () => {
    pollJobStatus.mockResolvedValue(ok("COMPLETED"));
    mount("RUNNING");
    await advance(0);
    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    await advance(10_000);
    expect(pollJobStatus).toHaveBeenCalledTimes(1);
  });

  it("takes the cancel route's answer through apply() and keeps the live answer", async () => {
    const live = {
      checked_at: "2026-09-30T12:00:46Z",
      queue_reason: "Priority",
      estimated_start: null,
      time_limit_seconds: 1380,
      progress: null,
    };
    pollJobStatus.mockResolvedValue({ ok: true, data: answer("PENDING", live) });
    const { result } = mount("PENDING");
    await advance(0);
    expect(result.current.live).toEqual(live);

    const cancelled = { ...answer("PENDING"), cancel_requested_at: "2026-09-30T12:01:00Z" };
    delete (cancelled as { live?: unknown }).live;
    act(() => result.current.apply(cancelled));
    expect(result.current.cancelling).toBe(true);
    expect(result.current.live).toEqual(live);
  });

  it("keeps the live answer when the cancel route answers with live: null", async () => {
    const live = {
      checked_at: "2026-09-30T12:00:46Z",
      queue_reason: "Priority",
      estimated_start: null,
      time_limit_seconds: 1380,
      progress: null,
    };
    pollJobStatus.mockResolvedValueOnce({ ok: true, data: answer("PENDING", live) });
    pollJobStatus.mockResolvedValue({ ok: true, data: answer("PENDING", null) });
    const { result } = mount("PENDING");
    await advance(0);
    expect(result.current.live).toEqual(live);

    act(() =>
      result.current.apply({ ...answer("PENDING", null), cancel_requested_at: "2026-09-30T12:01:00Z" })
    );
    expect(result.current.cancelling).toBe(true);
    expect(result.current.live).toEqual(live);

    // A poll's explicit null still replaces it.
    await advance(5_000);
    expect(result.current.live).toBeNull();
  });
});
