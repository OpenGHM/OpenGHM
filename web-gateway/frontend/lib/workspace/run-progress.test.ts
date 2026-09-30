import { describe, expect, it } from "vitest";
import type { JobProgress } from "@/lib/jobs/types";
import { describeProgress, elapsedSeconds, walltimeUsed } from "@/lib/workspace/run-progress";

const NOW = Date.parse("2026-09-30T12:04:12Z");

describe("elapsedSeconds", () => {
  it("counts from the start", () => {
    expect(elapsedSeconds("2026-09-30T12:00:00Z", NOW)).toBe(252);
  });
  it("is never negative when the browser's clock is behind", () => {
    expect(elapsedSeconds("2026-09-30T12:10:00Z", NOW)).toBe(0);
  });
  it("is null without a readable start", () => {
    expect(elapsedSeconds(null, NOW)).toBeNull();
    expect(elapsedSeconds("soon", NOW)).toBeNull();
  });
});

describe("walltimeUsed", () => {
  it("is null without a limit", () => {
    expect(walltimeUsed(100, null)).toBeNull();
    expect(walltimeUsed(100, 0)).toBeNull();
  });
  it("turns amber at 80 % and red at 95 %", () => {
    expect(walltimeUsed(690, 1380)).toEqual({ percent: 50, tone: "normal" });
    expect(walltimeUsed(1103, 1380)?.tone).toBe("normal");
    expect(walltimeUsed(1104, 1380)?.tone).toBe("warning");
    expect(walltimeUsed(1310, 1380)?.tone).toBe("warning");
    expect(walltimeUsed(1311, 1380)?.tone).toBe("critical");
  });
  it("stops at 100 %", () => {
    expect(walltimeUsed(5000, 1380)).toEqual({ percent: 100, tone: "critical" });
  });
});

const RUN: JobProgress = {
  phase: "run",
  loop: null,
  loops: null,
  date: "2001-03-04",
  run_start: "2000-01-01",
  run_end: "2001-12-31",
  fraction: 0.58,
  line: "File wbm_2001.nc (2001-03-04) Balance=(0.00,0.00,0.00,   8.20,  109.09,   0.81,  0.00, 0.00,0.00) Spool+=2",
  read_at: "2026-09-30T12:04:10Z",
};

describe("describeProgress", () => {
  it("gives the run phase a determinate bar", () => {
    expect(describeProgress(RUN)).toEqual({
      headline: "Simulating 2001-03-04 · run 2000-01-01 → 2001-12-31 · 58 %",
      percent: 58,
      note: null,
    });
  });

  it("gives spin-up no percentage and says why", () => {
    const words = describeProgress({
      ...RUN,
      phase: "spinup",
      loop: 1,
      loops: 1,
      date: "2000-06-12",
      fraction: null,
    });
    expect(words.headline).toBe("Spin-up 1 of 1 · simulating 2000-06-12");
    expect(words.percent).toBeNull();
    expect(words.note).toBe("Spin-up length isn't reported, so no percentage.");
  });

  it("says WBM has not reported a date when there is no progress", () => {
    expect(describeProgress(null).note).toBe("WBM hasn't reported a simulated date yet.");
    expect(describeProgress(null).percent).toBeNull();
  });

  it("draws no bar for a run phase without a fraction", () => {
    const words = describeProgress({ ...RUN, fraction: null });
    expect(words.percent).toBeNull();
    expect(words.headline).toBe("Simulating 2001-03-04 · run 2000-01-01 → 2001-12-31");
  });
});
