import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE, listHref, parsePageSize, parseSort } from "@/lib/jobs/filters";

describe("the list's URL", () => {
  it("has no query for the first page of the default list", () => {
    expect(listHref(undefined)).toBe("/workspace");
    expect(listHref(undefined, 1, { size: DEFAULT_PAGE_SIZE, sort: "updated" })).toBe("/workspace");
  });

  it("carries the status, the page, the page size and the order, and only what is not the default", () => {
    expect(listHref("FAILED", 3, { size: 25, sort: "created" })).toBe(
      "/workspace?status=FAILED&page=3&size=25&sort=created",
    );
    expect(listHref(undefined, 1, { size: 50 })).toBe("/workspace?size=50");
  });
});

describe("the list's view params", () => {
  it("reads a page size the list offers, else the default", () => {
    expect(parsePageSize("25")).toBe(25);
    expect(parsePageSize("7")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
  });

  it("reads a known order, else the default", () => {
    expect(parseSort("created")).toBe("created");
    expect(parseSort("name")).toBe("updated");
    expect(parseSort(undefined)).toBe("updated");
  });
});
