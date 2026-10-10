import { describe, expect, it } from "vitest";
import { isExternalHref, safeHref, safeImageSrc } from "./links";

describe("safeHref", () => {
  it.each([
    "https://example.org/a?b=1#c",
    "http://example.org",
    "HTTPS://EXAMPLE.ORG",
    "mailto:info@openghm.org",
    "/community/workshops/first",
    "/",
  ])("accepts %s", (href) => {
    expect(safeHref(href)).toBe(href);
  });

  it("trims what it accepts", () => {
    expect(safeHref("  /community  ")).toBe("/community");
  });

  it.each([
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<script>",
    "vbscript:x",
    "//evil.example",
    "/\\evil.example",
    "ftp://example.org",
    "example.org",
    "#anchor",
    "https://",
    "mailto:",
    "",
    "   ",
    "/ok\u0000",
  ])("refuses %j", (href) => {
    expect(safeHref(href)).toBeNull();
  });

  it("refuses what is not a string", () => {
    expect(safeHref(undefined)).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref(42)).toBeNull();
    expect(safeHref({ href: "/x" })).toBeNull();
  });
});

describe("isExternalHref", () => {
  it("is true for http(s) and false for a path or a mailto link", () => {
    expect(isExternalHref("https://example.org")).toBe(true);
    expect(isExternalHref("http://example.org")).toBe(true);
    expect(isExternalHref("/community")).toBe(false);
    expect(isExternalHref("mailto:a@b.org")).toBe(false);
  });
});

describe("safeImageSrc", () => {
  it("accepts https and paths on this site", () => {
    expect(safeImageSrc("https://example.org/a.png")).toBe("https://example.org/a.png");
    expect(safeImageSrc("/api/community/files/65f1a2b3c4d5e6f708192a3b")).toBe(
      "/api/community/files/65f1a2b3c4d5e6f708192a3b"
    );
  });

  it.each([
    "http://example.org/a.png",
    "javascript:alert(1)",
    "data:image/svg+xml,<svg>",
    "//evil.example/a.png",
    "a.png",
    "",
    null,
    undefined,
  ])("refuses %j", (src) => {
    expect(safeImageSrc(src)).toBeNull();
  });
});
