import { describe, expect, it } from "vitest";
import {
  ANVIL_SHARED_MB_PER_CORE,
  automaticWalltimeLabel,
  describeCoresBelowRecommended,
  describeHours,
  describeRunOverLimit,
  describeSlurmTime,
  effectiveCompute,
  estimatedRunLabel,
  estimatedRunSeconds,
  formatSlurmTime,
  withHeadroom,
  parseSlurmTime,
  postProcessingShare,
  recommendedSeconds,
  runOverLimit,
  runsClimatology,
  sharedMemoryGb,
  submitBlockedReason,
  validateSlurmConfig,
} from "@/lib/jobs/compute";

describe("parseSlurmTime", () => {
  it.each([
    ["15", 900],
    ["15:00", 900],
    ["01:30:00", 5400],
    ["111:30:00", 401400],
    ["1-12", 129600],
    ["1-12:30:15", 131415],
  ])("reads %s as SLURM does", (value, seconds) => {
    expect(parseSlurmTime(value)).toBe(seconds);
  });

  it("refuses what is not a time", () => {
    expect(parseSlurmTime("soon")).toBeNull();
    expect(parseSlurmTime("")).toBeNull();
  });

  it("describes a duration for a person", () => {
    expect(describeSlurmTime("15:00")).toBe("15 min");
    expect(describeSlurmTime("22:30")).toBe("22 min 30 s");
    expect(describeSlurmTime("02:30:00")).toBe("2 h 30 min");
    expect(describeSlurmTime("111:30:00")).toBe("4 d 15 h");
  });
});

describe("withHeadroom", () => {
  // The same cases as tests/test_job_script.py: the two sides must agree.
  it.each([
    ["15:00", "22:30"],
    ["4:30:00", "6:45:00"],
    ["04:30:00", "6:45:00"],
    ["10:00", "15:00"],
    ["1:00", "1:30"],
    ["60", "1:30:00"],
    ["1-00:00:00", "36:00:00"],
    ["0:01", "0:02"],
    ["80:00:00", "96:00:00"], // 120 h would be over the limit: capped
    ["64:00:00", "96:00:00"],
    ["111:30:00", "96:00:00"], // the recommendation alone is over it
  ])("adds 50%% to %s, at most the limit: %s", (value, expected) => {
    expect(withHeadroom(value)).toBe(expected);
  });

  it("is null for what is not a time", () => {
    expect(withHeadroom("soon")).toBeNull();
  });

  it("writes SLURM's format", () => {
    expect(formatSlurmTime(1350)).toBe("22:30");
    expect(formatSlurmTime(24300)).toBe("6:45:00");
  });
});

describe("a recommendation over the limit for one job", () => {
  const unset = { cores: null };
  const snapshot = (walltime: string) => ({ cores: 16, walltime });

  it("writes hours however long, the way the backend does", () => {
    expect(describeHours(111 * 3600 + 30 * 60)).toBe("111 h 30 min");
    expect(describeHours(4 * 3600)).toBe("4 h");
    expect(describeHours(22 * 60 + 30)).toBe("22 min 30 s");
  });

  it("asks for the recommendation with headroom, at most one job's limit, and says when it is cut", () => {
    expect(effectiveCompute(unset, snapshot("111:30:00"))).toMatchObject({
      walltime: "96:00:00",
      walltimeCapped: true,
    });
    expect(effectiveCompute(unset, snapshot("80:00:00"))).toMatchObject({
      walltime: "96:00:00",
      walltimeCapped: true,
    });
    expect(effectiveCompute(unset, snapshot("4:30:00"))).toMatchObject({
      walltime: "6:45:00",
      walltimeCapped: false,
    });
    expect(effectiveCompute(unset, snapshot("15:00"))).toMatchObject({
      walltime: "22:30",
      walltimeCapped: false,
    });
  });

  it("labels the estimated run time as the recommendation, with no headroom", () => {
    expect(estimatedRunLabel()).toBe("model snapshot's recommendation");
    expect(estimatedRunLabel(true)).toBe("model snapshot's recommendation + post-processing");
  });

  it("labels the automatic time for what it is", () => {
    expect(automaticWalltimeLabel()).toBe("model snapshot's recommendation + 50%");
    expect(automaticWalltimeLabel("placeholder")).toBe("recommended + 50%");
  });
});

describe("the estimated run time and its limit", () => {
  const snapshot = (walltime: string, postProcessingWalltime?: string) => ({
    cores: 16,
    walltime,
    ...(postProcessingWalltime ? { postProcessingWalltime } : {}),
  });

  // The same cases as tests/test_job_script.py: the two sides must agree.
  it.each([
    ["15:00", undefined, false, 15 * 60],
    ["111:30:00", undefined, false, 111 * 3600 + 30 * 60],
    ["120:00:00", undefined, false, 120 * 3600], // not capped at one job's 96 h
    ["80:00:00", "20:00:00", true, 100 * 3600],
    ["80:00:00", "20:00:00", false, 80 * 3600],
    ["0:00:01", undefined, false, 1],
  ])("%s + %s, post-processing %s is estimated at %s s", (walltime, step, postProcessing, seconds) => {
    expect(estimatedRunSeconds(snapshot(walltime, step), postProcessing)).toBe(seconds);
  });

  it("is unknown without a snapshot or with a value that is not a time", () => {
    expect(estimatedRunSeconds(null)).toBeNull();
    expect(estimatedRunSeconds(snapshot("not a time"))).toBeNull();
    expect(runOverLimit(null)).toBeNull();
  });

  it("is over the limit only above two weeks", () => {
    expect(runOverLimit(snapshot("336:00:00"))).toBeNull(); // 336 h exactly
    expect(runOverLimit(snapshot("336:00:01"))).toBe(336 * 3600 + 1);
    expect(runOverLimit(snapshot("300:00:00", "40:00:00"), true)).toBe(340 * 3600);
    expect(runOverLimit(snapshot("300:00:00", "40:00:00"))).toBeNull();
  });

  it("says how long it is estimated to take, and the limit, as the backend does", () => {
    const rec = snapshot("450:00:00");
    expect(describeRunOverLimit(runOverLimit(rec)!, rec)).toBe(
      "This simulation is estimated to take about 450 h (the reference run), over the 2-week limit for one simulation."
    );
  });

  it("names the post-processing, and offers to turn it off only when the run alone would fit", () => {
    const fits = snapshot("320:00:00", "30:00:00");
    expect(describeRunOverLimit(runOverLimit(fits, true)!, fits, true)).toBe(
      "This simulation is estimated to take about 350 h (the reference run and its post-processing), over the 2-week limit for one simulation. Turn post-processing off to run it."
    );
    const never = snapshot("360:00:00", "30:00:00");
    expect(describeRunOverLimit(runOverLimit(never, true)!, never, true)).toBe(
      "This simulation is estimated to take about 390 h (the reference run and its post-processing), over the 2-week limit for one simulation."
    );
  });
});

describe("validateSlurmConfig", () => {
  it("accepts unset cores and the bounds", () => {
    expect(validateSlurmConfig({ cores: null })).toEqual({});
    expect(validateSlurmConfig({ cores: 128 })).toEqual({});
  });

  it("refuses what the backend refuses", () => {
    expect(validateSlurmConfig({ cores: 0 }).cores).toBeDefined();
    expect(validateSlurmConfig({ cores: 129 }).cores).toBeDefined();
    expect(validateSlurmConfig({ cores: 1.5 }).cores).toBeDefined();
  });
});

describe("effectiveCompute", () => {
  const recommended = { cores: 16, walltime: "15:00" };

  it("falls back to the snapshot's cores, and always asks for its walltime with headroom", () => {
    expect(effectiveCompute({ cores: null }, recommended)).toMatchObject({
      cores: 16,
      coresSource: "snapshot",
      walltime: "22:30", // 15:00 recommended plus 50%
    });
    expect(effectiveCompute({ cores: 4 }, recommended)).toMatchObject({
      cores: 4,
      coresSource: "draft",
      walltime: "22:30",
    });
  });
});

describe("submitBlockedReason", () => {
  const user = { role: "user", is_active: true, email_verified: true, can_run_simulations: true };

  it("lets a permitted user, staff and admin through", () => {
    expect(submitBlockedReason(user)).toBeNull();
    expect(submitBlockedReason({ ...user, role: "staff", can_run_simulations: false })).toBeNull();
    expect(submitBlockedReason({ ...user, role: "admin", can_run_simulations: false })).toBeNull();
  });

  it("explains each refusal, and leaves an unreadable profile to the backend", () => {
    expect(submitBlockedReason({ ...user, can_run_simulations: false })).toMatch(/administrator/);
    expect(submitBlockedReason({ ...user, role: "guest" })).toMatch(/administrator/);
    expect(submitBlockedReason({ ...user, email_verified: false })).toMatch(/Verify your email/);
    expect(submitBlockedReason({ ...user, is_active: false })).toMatch(/deactivated/);
    expect(submitBlockedReason(null)).toBeNull();
  });
});

describe("shared-partition memory", () => {
  it("is the figure verified on Anvil, 1896 MB a core", () => {
    expect(ANVIL_SHARED_MB_PER_CORE).toBe(1896);
  });

  it("is shown in GB with one decimal, from the total and not from the rounded per-core figure", () => {
    expect(sharedMemoryGb(1)).toBe("1.9");
    expect(sharedMemoryGb(2)).toBe("3.8");
    expect(sharedMemoryGb(3)).toBe("5.7");
    expect(sharedMemoryGb(64)).toBe("121.3"); // 64 x 1.9 would read 121.6
    expect(sharedMemoryGb(128)).toBe("242.7");
  });
});

describe("describeCoresBelowRecommended", () => {
  const rec = { cores: 64, walltime: "15:00" };
  const cores = (n: number | null) => ({ cores: n });

  it("warns, with the numbers, when cores are below the recommended count", () => {
    expect(describeCoresBelowRecommended(cores(1), rec)).toBe(
      "This model snapshot recommends 64 cores, enough memory for its simulation. " +
        "On Anvil's shared partition memory comes with cores, about 1.9 GB each, " +
        "so 64 cores gives about 121.3 GB and 1 core only about 1.9 GB: " +
        "the simulation may be stopped for running out of memory."
    );
  });

  it("builds the numbers from the values, and says cores in the plural", () => {
    const text = describeCoresBelowRecommended(cores(3), { cores: 16, walltime: "15:00" });
    expect(text).toContain("recommends 16 cores, enough memory for its simulation");
    expect(text).toContain("so 16 cores gives about 30.3 GB and 3 cores only about 5.7 GB:");
  });

  it("warns one core below, and never when at or above", () => {
    expect(describeCoresBelowRecommended(cores(63), rec)).toContain("and 63 cores only about 119.4 GB:");
    expect(describeCoresBelowRecommended(cores(64), rec)).toBeNull();
    expect(describeCoresBelowRecommended(cores(65), rec)).toBeNull();
    expect(describeCoresBelowRecommended(cores(128), rec)).toBeNull();
  });

  it("says nothing when cores are unset: the recommendation is used", () => {
    expect(describeCoresBelowRecommended(cores(null), rec)).toBeNull();
  });

  it("says nothing when the snapshot has no recommendation", () => {
    expect(describeCoresBelowRecommended(cores(1), null)).toBeNull();
  });

  it("leaves a value that is not a valid number of cores to the field's own error", () => {
    expect(describeCoresBelowRecommended(cores(0), rec)).toBeNull();
    expect(describeCoresBelowRecommended(cores(-2), rec)).toBeNull();
    expect(describeCoresBelowRecommended(cores(1.5), rec)).toBeNull();
  });
});

describe("a run that post-processes", () => {
  const unset = { cores: null };
  const snapshot = (walltime: string, postProcessingWalltime?: string) => ({
    cores: 16,
    walltime,
    ...(postProcessingWalltime ? { postProcessingWalltime } : {}),
  });

  it("adds the post-processing time only when the run has it and it was measured", () => {
    const recommended = snapshot("15:00", "1:30:00");
    expect(recommendedSeconds(recommended)).toBe(15 * 60);
    expect(recommendedSeconds(recommended, true)).toBe(15 * 60 + 90 * 60);
    expect(recommendedSeconds(snapshot("15:00"), true)).toBe(15 * 60);
    expect(recommendedSeconds(snapshot("not a time", "1:00:00"), true)).toBeNull();
    expect(recommendedSeconds(null, true)).toBeNull();
    expect(postProcessingShare(recommended, true)).toBe(90 * 60);
    expect(postProcessingShare(recommended, false)).toBe(0);
    expect(postProcessingShare(snapshot("15:00"), true)).toBe(0);
  });

  it("asks for the headroom of the sum, as the backend does", () => {
    // 15:00 + 1:00:00 = 1:15:00, and half as much again.
    expect(effectiveCompute(unset, snapshot("15:00", "1:00:00"), true)).toMatchObject({
      walltime: "1:52:30",
      walltimeCapped: false,
      includesPostProcessing: true,
    });
    expect(effectiveCompute(unset, snapshot("15:00", "1:00:00"))).toMatchObject({
      walltime: "22:30",
      includesPostProcessing: false,
    });
    expect(effectiveCompute(unset, snapshot("15:00"), true)).toMatchObject({
      walltime: "22:30",
      includesPostProcessing: false,
    });
    expect(effectiveCompute(unset, snapshot("80:00:00", "10:00:00"), true)).toMatchObject({
      walltime: "96:00:00",
      walltimeCapped: true,
    });
  });

  it("names the post-processing in the labels", () => {
    expect(automaticWalltimeLabel("summary", true)).toBe(
      "model snapshot's recommendation + post-processing + 50%"
    );
    expect(automaticWalltimeLabel("placeholder", true)).toBe("recommended + post-processing + 50%");
  });

  it("is a climatology run when the draft asks, or asks nothing and the snapshot does", () => {
    expect(runsClimatology("climatology", "standard")).toBe(true);
    expect(runsClimatology("climatology", null)).toBe(true);
    expect(runsClimatology(null, "climatology")).toBe(true);
    expect(runsClimatology(undefined, "climatology")).toBe(true);
    expect(runsClimatology("standard", "climatology")).toBe(false);
    expect(runsClimatology(null, "standard")).toBe(false);
    expect(runsClimatology(null, "none")).toBe(false);
    expect(runsClimatology(null, null)).toBe(false);
    expect(runsClimatology(null, undefined)).toBe(false);
  });
});
