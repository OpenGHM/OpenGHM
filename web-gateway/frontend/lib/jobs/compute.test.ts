import { describe, expect, it } from "vitest";
import {
  ANVIL_SHARED_MB_PER_CORE,
  automaticWalltimeLabel,
  describeCoresBelowReference,
  describeHours,
  describeSlurmTime,
  describeWalltimeBelowReference,
  describeWalltimeOverLimit,
  effectiveCompute,
  formatSlurmTime,
  withHeadroom,
  parseSlurmTime,
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

  it("says how long the reference run took, what one job may use, and what to do", () => {
    expect(describeWalltimeOverLimit(111 * 3600 + 30 * 60)).toBe(
      "This model snapshot's reference run took about 111 h 30 min, more than the 96 h one job may use. Shorten the run period, or set a walltime yourself (the run may be stopped when time runs out)."
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

  it("hints, softly, at a walltime shorter than the reference run", () => {
    const rec = snapshot("4:30:00");
    expect(describeWalltimeBelowReference({ cores: null, walltime: "02:00:00" }, rec)).toMatch(
      /reference run took about 4 h 30 min/
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

describe("describeCoresBelowReference", () => {
  const rec = { cores: 64, walltime: "15:00" };
  const cores = (n: number | null) => ({ cores: n, walltime: null });

  it("warns, with the numbers, when cores are below the reference run's", () => {
    expect(describeCoresBelowReference(cores(1), rec)).toBe(
      "This model snapshot's reference run used 64 cores (about 121.3 GB of memory). " +
        "Anvil's shared partition gives about 1.9 GB of memory per core, " +
        "so with 1 core (about 1.9 GB) the run may be stopped for running out of memory."
    );
  });

  it("builds the numbers from the values, and says cores in the plural", () => {
    const text = describeCoresBelowReference(cores(3), { cores: 16, walltime: "15:00" });
    expect(text).toContain("reference run used 16 cores (about 30.3 GB");
    expect(text).toContain("with 3 cores (about 5.7 GB)");
  });

  it("warns one core below, and never when at or above", () => {
    expect(describeCoresBelowReference(cores(63), rec)).toContain("with 63 cores (about 119.4 GB)");
    expect(describeCoresBelowReference(cores(64), rec)).toBeNull();
    expect(describeCoresBelowReference(cores(65), rec)).toBeNull();
    expect(describeCoresBelowReference(cores(128), rec)).toBeNull();
  });

  it("says nothing when cores are unset: the recommendation is used", () => {
    expect(describeCoresBelowReference(cores(null), rec)).toBeNull();
  });

  it("says nothing when the snapshot has no recommendation", () => {
    expect(describeCoresBelowReference(cores(1), null)).toBeNull();
  });

  it("leaves a value that is not a valid number of cores to the field's own error", () => {
    expect(describeCoresBelowReference(cores(0), rec)).toBeNull();
    expect(describeCoresBelowReference(cores(-2), rec)).toBeNull();
    expect(describeCoresBelowReference(cores(1.5), rec)).toBeNull();
  });
});
