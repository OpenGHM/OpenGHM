import { describe, expect, it } from "vitest";
import { formatRelative, formatUtcDate, formatUtcDateTime } from "@/lib/workspace/time";

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

describe("UTC formats", () => {
  it("are the same wherever they run", () => {
    expect(formatUtcDate("2026-09-30T23:30:00Z")).toBe("30 Sep 2026");
    expect(formatUtcDateTime("2026-09-30T19:04:00Z")).toBe("30 Sep 2026, 19:04 UTC");
  });
  it("hands an unreadable value back", () => {
    expect(formatUtcDate("soon")).toBe("soon");
  });
});
