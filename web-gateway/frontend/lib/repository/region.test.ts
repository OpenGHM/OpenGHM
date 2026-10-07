import { describe, expect, it } from "vitest";
import {
  edgeError,
  formatLatitude,
  formatLongitude,
  formatRegion,
  parseEdge,
  regionErrors,
  regionFromNumbers,
  regionFromText,
} from "./region";

const text = (north: string, south: string, west: string, east: string) => ({ north, south, west, east });

describe("parseEdge", () => {
  it.each([
    ["45", 45],
    ["-110.5", -110.5],
    ["+3", 3],
    [" 7 ", 7],
    [".5", 0.5],
    ["5.", 5],
    ["0", 0],
  ])("reads %j as %d", (input, expected) => {
    expect(parseEdge(input)).toBe(expected);
  });

  it.each(["", " ", "-", ".", "abc", "1e3", "1,5", "0x10", "Infinity", "NaN", "1 2"])(
    "reads %j as no number",
    (input) => {
      expect(parseEdge(input)).toBeNull();
    }
  );
});

describe("edgeError", () => {
  it("is quiet for an empty field (that is incomplete, not wrong) and for a value in range, ends included", () => {
    expect(edgeError("north", "")).toBeNull();
    expect(edgeError("north", "90")).toBeNull();
    expect(edgeError("south", "-90")).toBeNull();
    expect(edgeError("west", "-180")).toBeNull();
    expect(edgeError("east", "180")).toBeNull();
  });

  it("names a non-number and the range an edge may take", () => {
    expect(edgeError("north", "abc")).toBe("Enter a number");
    expect(edgeError("north", "90.1")).toBe("Must be between -90 and 90");
    expect(edgeError("south", "-91")).toBe("Must be between -90 and 90");
    expect(edgeError("west", "-180.5")).toBe("Must be between -180 and 180");
    expect(edgeError("east", "181")).toBe("Must be between -180 and 180");
  });
});

describe("regionErrors and regionFromText", () => {
  it("accept a whole box, and west above east as one across the antimeridian", () => {
    expect(regionFromText(text("45", "40", "-110", "-100"))).toEqual({
      north: 45,
      south: 40,
      west: -110,
      east: -100,
    });
    expect(regionErrors(text("10", "-10", "170", "-170"))).toEqual({});
    expect(regionFromText(text("10", "-10", "170", "-170"))).toEqual({
      north: 10,
      south: -10,
      west: 170,
      east: -170,
    });
  });

  it("accept a point and the whole globe", () => {
    expect(regionFromText(text("0", "0", "0", "0"))).not.toBeNull();
    expect(regionFromText(text("90", "-90", "-180", "180"))).not.toBeNull();
  });

  it("give no box while an edge is missing, without calling the missing one an error", () => {
    expect(regionFromText(text("45", "40", "-110", ""))).toBeNull();
    expect(regionErrors(text("45", "40", "-110", ""))).toEqual({});
  });

  it("report each bad edge on its own field", () => {
    const errors = regionErrors(text("100", "x", "-200", "5"));
    expect(Object.keys(errors).sort()).toEqual(["north", "south", "west"]);
    expect(regionFromText(text("100", "x", "-200", "5"))).toBeNull();
  });

  it("report a south above the north on South, and give no box", () => {
    expect(regionErrors(text("40", "45", "-110", "-100"))).toEqual({ south: "Must not be above North" });
    expect(regionFromText(text("40", "45", "-110", "-100"))).toBeNull();
    // touching is fine
    expect(regionFromText(text("40", "40", "-110", "-100"))).not.toBeNull();
  });
});

describe("regionFromNumbers", () => {
  it("is a box only when all four are set and valid", () => {
    expect(regionFromNumbers(45, 40, -100, -110)).toEqual({ north: 45, south: 40, east: -100, west: -110 });
    expect(regionFromNumbers(45, 40, -100, null)).toBeNull();
    expect(regionFromNumbers(null, null, null, null)).toBeNull();
    expect(regionFromNumbers(91, 40, -100, -110)).toBeNull();
    expect(regionFromNumbers(40, 45, -100, -110)).toBeNull();
    expect(regionFromNumbers(45, 40, NaN, -110)).toBeNull();
  });
});

describe("formatting", () => {
  it("writes a latitude and a longitude with their hemispheres", () => {
    expect(formatLatitude(45)).toBe("45°N");
    expect(formatLatitude(-10.5)).toBe("10.5°S");
    expect(formatLatitude(0)).toBe("0°");
    expect(formatLongitude(-110)).toBe("110°W");
    expect(formatLongitude(5)).toBe("5°E");
    expect(formatLongitude(0)).toBe("0°");
    expect(formatLongitude(180)).toBe("180°");
    expect(formatLongitude(-180)).toBe("180°");
  });

  it("writes a box south to north, then west to east", () => {
    expect(formatRegion({ north: 45, south: 40, east: -100, west: -110 })).toBe(
      "40°N – 45°N, 110°W – 100°W"
    );
    expect(formatRegion({ north: 10, south: -10, east: -170, west: 170 })).toBe(
      "10°S – 10°N, 170°E – 170°W"
    );
  });
});
