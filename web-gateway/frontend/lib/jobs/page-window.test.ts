import { describe, expect, it } from "vitest";
import { pageWindow } from "@/lib/jobs/page-window";

describe("pageWindow", () => {
  it("lists every page while there are few", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps the first, the last and the neighbours of a page in a long list, with gaps", () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, null, 20]);
    expect(pageWindow(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
    expect(pageWindow(20, 20)).toEqual([1, null, 19, 20]);
  });

  it("fills a gap of one page instead of drawing an ellipsis for it", () => {
    expect(pageWindow(4, 10)).toEqual([1, 2, 3, 4, 5, null, 10]);
  });
});
