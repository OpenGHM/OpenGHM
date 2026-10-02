import { describe, expect, it } from "vitest";
import { secondsBetween, shortDuration } from "@/lib/workspace/timeline";

describe("secondsBetween", () => {
  it("counts whole seconds", () => {
    expect(secondsBetween("2026-10-02T18:33:00Z", "2026-10-02T18:36:20Z")).toBe(200);
  });
  it("is null when either end is missing or unreadable", () => {
    expect(secondsBetween(null, "2026-10-02T18:36:20Z")).toBeNull();
    expect(secondsBetween("2026-10-02T18:36:20Z", null)).toBeNull();
    expect(secondsBetween("nonsense", "2026-10-02T18:36:20Z")).toBeNull();
  });
  it("never goes negative", () => {
    expect(secondsBetween("2026-10-02T18:36:20Z", "2026-10-02T18:36:00Z")).toBe(0);
  });
});

describe("shortDuration", () => {
  it.each([
    [0, "0 s"],
    [42, "42 s"],
    [60, "1 min"],
    [845, "14 min"],
    [3900, "1 h 5 min"],
    [7200, "2 h"],
  ])("%i s reads %s", (s, text) => {
    expect(shortDuration(s)).toBe(text);
  });
});
