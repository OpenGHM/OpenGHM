import { describe, expect, it } from "vitest";
import { splitVersion } from "@/lib/jobs/title-version";

describe("splitVersion", () => {
  it("takes the version out of the middle of a title and closes the gap", () => {
    expect(splitVersion("WBM v2.0.0 CONUS tutorial simulation, 2000–2001")).toEqual({
      version: "v2.0.0",
      rest: "WBM CONUS tutorial simulation, 2000–2001",
    });
  });

  it("reads a version at the end and a pre-release tag", () => {
    expect(splitVersion("Global run v1.2")).toEqual({ version: "v1.2", rest: "Global run" });
    expect(splitVersion("WBM v1.0.0-rc1 Global").version).toBe("v1.0.0-rc1");
  });

  it("leaves a title with no version alone", () => {
    expect(splitVersion("Global water-tracking simulation")).toEqual({
      version: null,
      rest: "Global water-tracking simulation",
    });
  });

  it("does not mistake a word that starts with v for a version", () => {
    expect(splitVersion("v2 of the model").version).toBeNull();
    expect(splitVersion("Vegetation v3x").version).toBeNull();
  });

  it("keeps a title that is only a version whole", () => {
    expect(splitVersion("v2.0.0")).toEqual({ version: null, rest: "v2.0.0" });
  });
});
