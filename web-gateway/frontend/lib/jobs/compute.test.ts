import { describe, expect, it } from "vitest";
import {
  describeSlurmTime,
  effectiveCompute,
  formatSlurmTime,
  withHeadroom,
  parseSlurmTime,
  secondsToHms,
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
  ])("adds 50%% to %s: %s", (value, expected) => {
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
