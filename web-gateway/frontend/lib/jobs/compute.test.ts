import { describe, expect, it } from "vitest";
import {
  ANVIL_SHARED_MB_PER_CORE,
  automaticWalltimeLabel,
  describeComputeSummary,
  describeCoresBelowRecommended,
  describeHours,
  describeSlurmTime,
  describeWalltimeBelowReference,
  describeWalltimeOverLimit,
  describeWalltimeOverLimitShort,
  effectiveCompute,
  formatSlurmTime,
  withHeadroom,
  parseSlurmTime,
  postProcessingShare,
  recommendedSeconds,
  runsClimatology,
  secondsToHms,
  sharedMemoryGb,
  submitBlockedReason,
  validateSlurmConfig,
  walltimeOverLimit,
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

  it("round-trips through HH:MM:SS", () => {
    expect(secondsToHms(parseSlurmTime("15:00")!)).toBe("00:15:00");
    expect(secondsToHms(parseSlurmTime("111:30:00")!)).toBe("111:30:00");
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
  const unset = { cores: null, walltime: null };
  const snapshot = (walltime: string) => ({ cores: 16, walltime });

  // The same cases as tests/test_job_script.py: the two sides must agree.
  it.each([
    ["111:30:00", 111 * 3600 + 30 * 60],
    ["96:00:01", 96 * 3600 + 1],
    ["96:00:00", null],
    ["80:00:00", null],
    ["4:30:00", null],
    ["15:00", null],
    ["not a time", null],
  ])("%s", (walltime, over) => {
    expect(walltimeOverLimit(unset, snapshot(walltime))).toBe(over);
    // A walltime the draft chose is not refused.
    expect(walltimeOverLimit({ cores: null, walltime: "02:00:00" }, snapshot(walltime))).toBeNull();
  });

  it("is not known without the snapshot", () => {
    expect(walltimeOverLimit(unset, null)).toBeNull();
  });

  it("says how long the reference simulation took, what one job may use, and what to do", () => {
    expect(describeWalltimeOverLimit(111 * 3600 + 30 * 60)).toBe(
      "This model snapshot's reference simulation took about 111 h 30 min, more than the 96 h one job may use. Shorten the run period, or set a walltime yourself (the simulation may be stopped when time runs out)."
    );
  });

  it("writes hours however long, the way the backend does", () => {
    expect(describeHours(111 * 3600 + 30 * 60)).toBe("111 h 30 min");
    expect(describeHours(4 * 3600)).toBe("4 h");
    expect(describeHours(22 * 60 + 30)).toBe("22 min 30 s");
  });

  it("shows the automatic walltime capped, and says so", () => {
    expect(effectiveCompute(unset, snapshot("111:30:00"))).toMatchObject({
      walltime: "96:00:00",
      walltimeSource: "snapshot",
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
    expect(effectiveCompute({ cores: null, walltime: "96:00:00" }, snapshot("111:30:00"))).toMatchObject({
      walltime: "96:00:00",
      walltimeSource: "draft",
      walltimeCapped: false,
    });
  });

  it("labels the automatic walltime for what it is", () => {
    expect(automaticWalltimeLabel(false)).toBe("model snapshot's recommendation + 50%");
    expect(automaticWalltimeLabel(false, "placeholder")).toBe("recommended + 50%");
    expect(automaticWalltimeLabel(true)).toBe("the limit for one job");
  });

  it("hints, softly, at a walltime shorter than the reference simulation", () => {
    const rec = snapshot("4:30:00");
    expect(describeWalltimeBelowReference({ cores: null, walltime: "02:00:00" }, rec)).toMatch(
      /reference simulation took about 4 h 30 min/
    );
    expect(describeWalltimeBelowReference({ cores: null, walltime: "04:30:00" }, rec)).toBeNull();
    expect(describeWalltimeBelowReference({ cores: null, walltime: "08:00:00" }, rec)).toBeNull();
    expect(describeWalltimeBelowReference(unset, rec)).toBeNull();
    expect(describeWalltimeBelowReference({ cores: null, walltime: "02:00:00" }, null)).toBeNull();
    expect(describeWalltimeBelowReference({ cores: null, walltime: "x" }, rec)).toBeNull();
  });
});

describe("validateSlurmConfig", () => {
  it("accepts unset values and the bounds", () => {
    expect(validateSlurmConfig({ cores: null, walltime: null })).toEqual({});
    expect(validateSlurmConfig({ cores: 128, walltime: "96:00:00" })).toEqual({});
  });

  it("refuses what the backend refuses", () => {
    expect(validateSlurmConfig({ cores: 0, walltime: null }).cores).toBeDefined();
    expect(validateSlurmConfig({ cores: 129, walltime: null }).cores).toBeDefined();
    expect(validateSlurmConfig({ cores: 1.5, walltime: null }).cores).toBeDefined();
    for (const walltime of ["15:00", "00:00:00", "96:00:01", "02:61:00", "x"]) {
      expect(validateSlurmConfig({ cores: null, walltime }).walltime).toBeDefined();
    }
  });
});

describe("effectiveCompute and the PATCH payload", () => {
  const recommended = { cores: 16, walltime: "15:00" };

  it("falls back to the snapshot's recommendation, in the backend's order", () => {
    expect(effectiveCompute({ cores: null, walltime: null }, recommended)).toMatchObject({
      cores: 16,
      coresSource: "snapshot",
      walltime: "22:30", // 15:00 recommended plus 50%; cores as recommended
      walltimeSource: "snapshot",
    });
    expect(effectiveCompute({ cores: 4, walltime: "02:00:00" }, recommended)).toMatchObject({
      cores: 4,
      coresSource: "draft",
      walltime: "02:00:00",
      walltimeSource: "draft",
    });
  });

  it("sends a walltime the user chose as given, without headroom", () => {
    expect(effectiveCompute({ cores: null, walltime: "00:15:00" }, recommended)).toMatchObject({
      cores: 16,
      walltime: "00:15:00",
      walltimeSource: "draft",
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
  const cores = (n: number | null) => ({ cores: n, walltime: null });

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

describe("describeComputeSummary", () => {
  it("says what the snapshot recommends when the draft sets nothing", () => {
    expect(describeComputeSummary({ cores: null, walltime: null }, { cores: 2, walltime: "15:00" })).toEqual({
      custom: false,
      text: "Recommended: 2 cores · 22 min 30 s",
    });
  });

  it("says when the automatic walltime is the limit for one job", () => {
    expect(describeComputeSummary({ cores: null, walltime: null }, { cores: 26, walltime: "111:30:00" })).toEqual({
      custom: false,
      text: "Recommended: 26 cores · 4 d (limit for one job)",
    });
  });

  it("says Custom when either value is the draft's own, and marks the part it left to the snapshot", () => {
    const recommended = { cores: 26, walltime: "111:30:00" };
    expect(describeComputeSummary({ cores: 8, walltime: "12:00:00" }, recommended)).toEqual({
      custom: true,
      text: "Custom: 8 cores · 12 h",
    });
    expect(describeComputeSummary({ cores: 8, walltime: null }, recommended).text).toBe(
      "Custom: 8 cores · 4 d (limit for one job)"
    );
    expect(describeComputeSummary({ cores: null, walltime: "02:00:00" }, { cores: 1, walltime: "15:00" }).text).toBe(
      "Custom: 1 core (recommended) · 2 h"
    );
    expect(describeComputeSummary({ cores: 4, walltime: null }, { cores: 26, walltime: "15:00" }).text).toBe(
      "Custom: 4 cores · 22 min 30 s (recommended + 50%)"
    );
  });

  it("does not guess what it cannot know without a snapshot", () => {
    expect(describeComputeSummary({ cores: null, walltime: null }, null).text).toBe(
      "Recommended: set by the model snapshot"
    );
    expect(describeComputeSummary({ cores: 8, walltime: null }, null).text).toBe("Custom: 8 cores");
  });
});

describe("a run that post-processes", () => {
  const unset = { cores: null, walltime: null };
  const snapshot = (walltime: string, postProcessingWalltime?: string) => ({
    cores: 16,
    walltime,
    ...(postProcessingWalltime ? { postProcessingWalltime } : {}),
  });

  // The same cases as tests/test_job_script.py: the two sides must agree.
  it.each([
    ["80:00:00", "20:00:00", true, 100 * 3600],
    ["80:00:00", "20:00:00", false, null],
    ["80:00:00", "16:00:00", true, null],
    ["80:00:00", "16:00:01", true, 96 * 3600 + 1],
    ["80:00:00", undefined, true, null],
    ["111:30:00", "1:00:00", true, 112 * 3600 + 30 * 60],
    ["15:00", "1:00:00", true, null],
  ])("%s + %s, post-processing %s", (walltime, step, postProcessing, over) => {
    expect(walltimeOverLimit(unset, snapshot(walltime, step), postProcessing)).toBe(over);
    // A walltime the draft chose is not refused.
    expect(walltimeOverLimit({ cores: null, walltime: "02:00:00" }, snapshot(walltime, step), postProcessing)).toBeNull();
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
      walltimeSource: "snapshot",
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
    expect(effectiveCompute({ cores: null, walltime: "03:00:00" }, snapshot("15:00", "1:00:00"), true)).toMatchObject({
      walltime: "03:00:00",
      walltimeSource: "draft",
      includesPostProcessing: false,
    });
    expect(effectiveCompute(unset, snapshot("80:00:00", "10:00:00"), true)).toMatchObject({
      walltime: "96:00:00",
      walltimeCapped: true,
    });
  });

  it("names the post-processing in the labels and the over-limit sentences", () => {
    expect(automaticWalltimeLabel(false, "summary", true)).toBe(
      "model snapshot's recommendation + post-processing + 50%"
    );
    expect(automaticWalltimeLabel(false, "placeholder", true)).toBe("recommended + post-processing + 50%");
    expect(automaticWalltimeLabel(true, "summary", true)).toBe("the limit for one job");
    expect(describeWalltimeOverLimit(100 * 3600, 20 * 3600)).toContain(
      "reference simulation took about 80 h, and its post-processing about 20 h more"
    );
    expect(describeWalltimeOverLimitShort(100 * 3600, 20 * 3600)).toContain(
      "post-processing took about 100 h together"
    );
    expect(describeWalltimeOverLimitShort(111 * 3600)).not.toContain("post-processing");
  });

  it("says Custom with the post-processing in the automatic walltime", () => {
    expect(describeComputeSummary({ cores: 4, walltime: null }, snapshot("15:00", "1:00:00"), true).text).toBe(
      "Custom: 4 cores · 1 h 52 min (recommended + post-processing + 50%)"
    );
  });

  it("mentions the post-processing when a walltime of the draft's own is below the reference", () => {
    const below = { cores: null, walltime: "00:30:00" };
    expect(describeWalltimeBelowReference(below, snapshot("15:00", "1:00:00"), true)).toContain(
      "reference simulation and its post-processing took about 1 h 15 min"
    );
    expect(describeWalltimeBelowReference(below, snapshot("15:00", "1:00:00"))).toBeNull();
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
