import { describe, expect, it } from "vitest";
import type { PreviousJob } from "@/lib/jobs/types";
import {
  currentJobNumber,
  describeContinuation,
  describeContinuationTries,
  describeJobNumber,
  jobCount,
  jobRanSeconds,
  previousRanSeconds,
  waitingSince,
} from "@/lib/workspace/job-runs";

const previous = (number: number, over: Partial<PreviousJob> = {}): PreviousJob => ({
  number,
  slurm_job_id: `100${number}`,
  slurm_state: "TIMEOUT",
  slurm_start: "2026-10-01T00:00:00Z",
  slurm_end: "2026-10-05T00:00:00Z",
  state_saved_at: "2026-10-04T22:00:00Z",
  ...over,
});

describe("which job, and how many", () => {
  it("reads a simulation of one job, or an answer without the fields, as job 1", () => {
    expect(currentJobNumber({})).toBe(1);
    expect(jobCount({})).toBe(1);
    expect(jobCount({ previous_jobs: [], job_number: 1, max_jobs: 5, continuation: null })).toBe(1);
    expect(describeJobNumber({ previous_jobs: [], job_number: 1, max_jobs: 5, continuation: null })).toBeNull();
    expect(describeContinuation({})).toBeNull();
  });

  it("takes the backend's job number, and counts the ended jobs when it gave none", () => {
    expect(currentJobNumber({ job_number: 3, previous_jobs: [previous(1), previous(2)] })).toBe(3);
    expect(currentJobNumber({ previous_jobs: [previous(1)] })).toBe(2);
  });

  it("counts the job being submitted, though it has not started", () => {
    const runs = {
      previous_jobs: [previous(1)],
      job_number: 1,
      max_jobs: 5,
      continuation: { number: 2, requested_at: "2026-10-05T00:00:05Z", tries: 0 },
    };
    expect(jobCount(runs)).toBe(2);
  });

  it("says Job N of at most M from the second job on", () => {
    expect(describeJobNumber({ previous_jobs: [previous(1)], job_number: 2, max_jobs: 5 })).toBe("Job 2 of at most 5");
    expect(describeContinuation({ previous_jobs: [previous(1)], job_number: 2 })).toBe(
      "Continued after the previous job reached its time limit, from the state WBM had saved."
    );
  });

  it("names the job being submitted while it is", () => {
    expect(
      describeJobNumber({
        previous_jobs: [previous(1)],
        job_number: 1,
        max_jobs: 5,
        continuation: { number: 2, requested_at: "2026-10-05T00:00:05Z", tries: 1 },
      })
    ).toBe("Job 2 of at most 5");
  });

  it("leaves out the most when the backend did not say", () => {
    expect(describeJobNumber({ previous_jobs: [previous(1)], job_number: 2, max_jobs: 0 })).toBe("Job 2");
  });
});

describe("a submit of the next job that has not gone through", () => {
  it("says nothing the first time, and how many attempts did not go through after that", () => {
    const at = "2026-10-05T00:00:05Z";
    expect(describeContinuationTries({ number: 2, requested_at: at, tries: 0 })).toBeNull();
    expect(describeContinuationTries({ number: 2, requested_at: at, tries: 1 })).toBe(
      "1 earlier attempt did not go through; the gateway tries again."
    );
    expect(describeContinuationTries({ number: 2, requested_at: at, tries: 3 })).toBe(
      "3 earlier attempts did not go through; the gateway tries again."
    );
  });
});

describe("how long the jobs ran", () => {
  it("is SLURM's start to its end, and nothing when either is missing", () => {
    expect(jobRanSeconds(previous(1))).toBe(4 * 86_400);
    expect(jobRanSeconds(previous(1, { slurm_end: null }))).toBeNull();
    expect(jobRanSeconds(previous(1, { slurm_start: null }))).toBeNull();
  });

  it("adds up the jobs that have both, and is nothing when none has", () => {
    expect(previousRanSeconds([previous(1), previous(2)])).toBe(8 * 86_400);
    expect(previousRanSeconds([previous(1), previous(2, { slurm_end: null })])).toBe(4 * 86_400);
    expect(previousRanSeconds([previous(1, { slurm_start: null })])).toBeNull();
    expect(previousRanSeconds([])).toBeNull();
    expect(previousRanSeconds(undefined)).toBeNull();
  });
});

describe("when the job now running began to wait", () => {
  it("is the end of the job before it, so it does not wait for the whole of the jobs before it", () => {
    expect(waitingSince([previous(1), previous(2, { slurm_end: "2026-10-09T00:00:00Z" })], "2026-10-01T00:00:00Z")).toBe(
      "2026-10-09T00:00:00Z"
    );
  });

  it("is the simulation's submit for the first job", () => {
    expect(waitingSince([], "2026-10-01T00:00:00Z")).toBe("2026-10-01T00:00:00Z");
    expect(waitingSince(undefined, null)).toBeNull();
    expect(waitingSince([previous(1, { slurm_end: null })], "2026-10-01T00:00:00Z")).toBe("2026-10-01T00:00:00Z");
  });
});
