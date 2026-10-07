import { describe, expect, it } from "vitest";
import {
  BACKOFF_STEPS_MS,
  POLL_INTERVAL_MS,
  describePollError,
  isFollowed,
  mergeView,
  nextPollDelay,
  toView,
  visibilityAction,
} from "@/lib/workspace/live-poll";
import type { JobLive, JobStatusResponse } from "@/lib/jobs/types";

describe("nextPollDelay", () => {
  it("polls every 5 s while nothing has failed", () => {
    expect(POLL_INTERVAL_MS).toBe(5_000);
    expect(nextPollDelay(0)).toBe(5_000);
  });

  it("backs off 5, 10, 20, 40, then 60 s at most", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(nextPollDelay)).toEqual([
      5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000, 60_000,
    ]);
    expect(BACKOFF_STEPS_MS).toEqual([5_000, 10_000, 20_000, 40_000, 60_000]);
  });

  it("starts over after a good answer (zero failures)", () => {
    expect(nextPollDelay(0)).toBe(POLL_INTERVAL_MS);
  });
});

describe("visibilityAction", () => {
  it("pauses when the tab is hidden, whether or not polling had stopped", () => {
    expect(visibilityAction(false, false)).toBe("pause");
    expect(visibilityAction(false, true)).toBe("pause");
  });
  it("polls at once when shown again, unless polling has ended", () => {
    expect(visibilityAction(true, false)).toBe("poll");
    expect(visibilityAction(true, true)).toBe("none");
  });
});

describe("describePollError", () => {
  it("names Anvil for a gateway timeout, the gateway when the call did not run", () => {
    expect(describePollError({ status: 502 })).toBe("Couldn't reach Anvil");
    expect(describePollError({ status: 504 })).toBe("Couldn't reach Anvil");
    expect(describePollError({ thrown: true })).toBe("Couldn't reach the gateway");
    expect(describePollError({ status: 500 })).toBe("Couldn't check the job's status");
    expect(describePollError({})).toBe("Couldn't check the job's status");
    expect(describePollError({ code: "backend_unreachable" })).toBe("Couldn't reach the gateway");
  });
});

const LIVE: JobLive = {
  checked_at: "2026-09-30T12:00:46Z",
  queue_reason: "Priority",
  estimated_start: null,
  time_limit_seconds: 1380,
  progress: null,
};

const RESPONSE: JobStatusResponse = {
  job_id: "j1",
  sim_id: "sim-1",
  status: "PENDING",
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
};

describe("mergeView", () => {
  it("takes the new live answer, including an explicit null", () => {
    const first = toView("PENDING", { ...RESPONSE, live: LIVE });
    expect(first.live).toEqual(LIVE);
    expect(mergeView(first, { ...RESPONSE, status: "COMPLETED", live: null }).live).toBeNull();
  });

  it("keeps the live answer when the response has none (the cancel route's)", () => {
    const first = toView("PENDING", { ...RESPONSE, live: LIVE });
    const next = mergeView(first, { ...RESPONSE, cancel_requested_at: "2026-09-30T12:01:00Z" });
    expect(next.live).toEqual(LIVE);
    expect(next.cancel_requested_at).toBe("2026-09-30T12:01:00Z");
  });
});

describe("isFollowed", () => {
  it("follows a job until it is over", () => {
    expect(isFollowed("PENDING", null)).toBe(true);
    expect(isFollowed("RUNNING", undefined)).toBe(true);
    expect(isFollowed("COMPLETED", null)).toBe(false);
    expect(isFollowed("FAILED", null)).toBe(false);
    expect(isFollowed("CANCELLED", undefined)).toBe(false);
  });

  it("keeps following a finished job while its draft is being published, and stops when the publish has ended", () => {
    const record = (state: "publishing" | "published" | "failed") => ({ state }) as never;
    expect(isFollowed("COMPLETED", record("publishing"))).toBe(true);
    expect(isFollowed("COMPLETED", record("published"))).toBe(false);
    expect(isFollowed("COMPLETED", record("failed"))).toBe(false);
  });
});

describe("the publish record in the view", () => {
  const base = { job_id: "j", sim_id: "s", status: "COMPLETED" } as JobStatusResponse;
  const record = { state: "publishing", snapshot_id: "ab" } as never;

  it("is null until the answer carries one, and the answer's otherwise", () => {
    expect(toView("COMPLETED").publish).toBeNull();
    expect(toView("COMPLETED", { publish: record }).publish).toBe(record);
  });

  it("is kept across an answer without a `publish` key, and replaced by an explicit one", () => {
    const held = toView("COMPLETED", { publish: record });
    expect(mergeView(held, { ...base }).publish).toBe(record);
    expect(mergeView(held, { ...base, publish: null }).publish).toBeNull();
  });
});
