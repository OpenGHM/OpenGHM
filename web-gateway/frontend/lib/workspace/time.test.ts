import { describe, expect, it } from "vitest";
import {
  formatAge,
  formatDuration,
  formatRelative,
  formatUtcDate,
  formatUtcDateTime,
} from "@/lib/workspace/time";

const NOW = Date.parse("2026-09-30T12:00:00Z");

describe("formatRelative", () => {
  it.each([
    ["2026-09-30T11:59:40Z", "just now"],
    ["2026-09-30T11:57:00Z", "3 min ago"],
    ["2026-09-30T10:00:00Z", "2 h ago"],
    ["2026-09-28T12:00:00Z", "2 days ago"],
    ["2026-09-29T12:00:00Z", "24 h ago"],
    ["2026-09-30T12:03:00Z", "in 3 min"],
  ])("reads %s as %s", (iso, text) => {
    expect(formatRelative(iso, NOW)).toBe(text);
  });
});

describe("formatRelative with a clock that trails by a tick", () => {
  const TICK = 30_000;
  // The component's clock is the real time rounded down to 30 s.
  const floored = (real: number) => Math.floor(real / TICK) * TICK;

  it("never reads an event that just happened as in the future", () => {
    const event = Date.parse("2026-09-30T12:00:29Z");
    for (let s = 0; s < 120; s++) {
      const real = event + s * 1000;
      const text = formatRelative(new Date(event).toISOString(), floored(real), TICK);
      expect(text, `${s} s after the event`).not.toMatch(/^in /);
    }
  });

  it("would have said in a moment without the tolerance", () => {
    const now = floored(Date.parse("2026-09-30T12:00:31Z")); // 12:00:30
    // An event 29 s ago by the real clock is 1 s in the future by the floored one.
    expect(formatRelative("2026-09-30T12:00:40Z", now)).toBe("in a moment");
    expect(formatRelative("2026-09-30T12:00:40Z", now, TICK)).toBe("just now");
  });

  it("still reads a time really ahead as in N min", () => {
    const now = Date.parse("2026-09-30T12:00:00Z");
    expect(formatRelative("2026-09-30T12:03:00Z", now, TICK)).toBe("in 3 min");
    expect(formatRelative("2026-09-30T12:00:40Z", now, TICK)).toBe("in a moment");
    expect(formatRelative("2026-09-30T14:00:00Z", now, TICK)).toBe("in 2 h");
  });
});

describe("UTC formats", () => {
  it("are the same wherever they run", () => {
    expect(formatUtcDate("2026-09-30T23:30:00Z")).toBe("30 Sep 2026");
    expect(formatUtcDateTime("2026-09-30T19:04:00Z")).toBe("30 Sep 2026, 19:04 UTC");
  });
  it("hands an unreadable value back", () => {
    expect(formatUtcDate("soon")).toBe("soon");
  });
});

describe("formatAge", () => {
  it.each([
    [0, "0 s ago"],
    [5_400, "5 s ago"],
    [59_999, "59 s ago"],
    [60_000, "1 min ago"],
    [125_000, "2 min ago"],
    [3_600_000, "1 h ago"],
    [-5_000, "0 s ago"],
  ])("reads %i ms as %s", (ms, text) => {
    expect(formatAge(ms)).toBe(text);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "0 s"],
    [42, "42 s"],
    [252, "4 min 12 s"],
    [240, "4 min"],
    [3903, "1 h 5 min 3 s"],
    [3600, "1 h"],
    [345_600, "96 h"],
  ])("reads %i s as %s", (s, text) => {
    expect(formatDuration(s)).toBe(text);
  });
  it("can leave the seconds off, for a limit", () => {
    expect(formatDuration(1380, { withSeconds: false })).toBe("23 min");
    expect(formatDuration(3660, { withSeconds: false })).toBe("1 h 1 min");
    expect(formatDuration(20, { withSeconds: false })).toBe("0 min");
  });
});
