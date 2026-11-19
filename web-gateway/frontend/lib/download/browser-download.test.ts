import { describe, expect, it } from "vitest";
import { showsInline } from "./browser-download";

describe("showsInline", () => {
  it("is true for what a browser shows: text, JSON, XML, images, PDF, and an unknown type", () => {
    for (const type of [
      "text/plain; charset=UTF-8",
      "text/csv",
      "application/json",
      "application/geo+json",
      "application/xml",
      "image/png",
      "application/pdf",
      null,
      "",
    ]) {
      expect(showsInline(type)).toBe(true);
    }
  });

  it("is false for what a browser saves, as the bucket sends NetCDF and most files", () => {
    for (const type of ["binary/octet-stream; charset=UTF-8", "application/octet-stream", "application/x-netcdf", "application/zip"]) {
      expect(showsInline(type)).toBe(false);
    }
  });
});
