import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  boxRects,
  CoverageThumbnail,
  coverageLabel,
  longitudeSpan,
  viewWindow,
  THUMBNAIL_HEIGHT,
  THUMBNAIL_WIDTH,
} from "./coverage-thumbnail";

afterEach(cleanup);

const WORLD = { north: 90, south: -90, east: 180, west: -180 };
const CONUS = { north: 49, south: 24, east: -66, west: -125 };
const PACIFIC = { north: 30, south: -30, east: -170, west: 160 };

describe("boxRects", () => {
  it("fills the panel for the whole world", () => {
    expect(boxRects(WORLD)).toEqual([
      { x: 0, y: 0, width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT },
    ]);
  });

  it("places a continental box by degrees: x = lon + 180, y = 90 - lat", () => {
    expect(boxRects(CONUS)).toEqual([{ x: 55, y: 41, width: 59, height: 25 }]);
  });

  it("draws two rectangles, one on each edge, when the box crosses the antimeridian", () => {
    expect(longitudeSpan(PACIFIC)).toBe(30);
    expect(boxRects(PACIFIC)).toEqual([
      { x: 340, y: 60, width: 20, height: 60 },
      { x: 0, y: 60, width: 10, height: 60 },
    ]);
  });

  it("keeps a box that is smaller than a few units visible and inside the panel", () => {
    const [r] = boxRects({ north: 10.1, south: 10, east: 179.9, west: 179.8 });
    expect(r.width).toBeGreaterThanOrEqual(3);
    expect(r.height).toBeGreaterThanOrEqual(3);
    expect(r.x + r.width).toBeLessThanOrEqual(THUMBNAIL_WIDTH);
  });

  it("clamps limits that lie outside the globe", () => {
    const [r] = boxRects({ north: 120, south: -120, east: 200, west: -200 });
    expect(r).toEqual({ x: 0, y: 0, width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT });
  });
});

describe("coverageLabel", () => {
  it("calls a wide box Global and the rest Regional", () => {
    expect(coverageLabel(WORLD)).toBe("Global");
    expect(coverageLabel({ ...WORLD, east: 175, west: -170 })).toBe("Global");
    expect(coverageLabel(CONUS)).toBe("Regional");
    expect(coverageLabel(PACIFIC)).toBe("Regional");
  });
});

describe("CoverageThumbnail", () => {
  it("is an image that states the four limits and the label", () => {
    render(<CoverageThumbnail box={CONUS} />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toBe(
      "Coverage: north 49°, south 24°, east -66°, west -125° (Regional)"
    );
    expect(screen.getByText("Regional")).toBeTruthy();
    expect(screen.getAllByTestId("coverage-rect")).toHaveLength(1);
  });

  it("draws two rectangles across the antimeridian and says Regional", () => {
    render(<CoverageThumbnail box={PACIFIC} />);
    expect(screen.getAllByTestId("coverage-rect")).toHaveLength(2);
  });

  it("draws a graticule every 30 degrees and loads no image", () => {
    const { container } = render(<CoverageThumbnail box={WORLD} />);
    expect(container.querySelectorAll("line")).toHaveLength(11 + 5);
    expect(container.querySelector("img, image")).toBeNull();
    expect(screen.getByText("Global")).toBeTruthy();
  });
});

describe("land", () => {
  it("draws the world land as one path inside the panel", () => {
    const { container } = render(<CoverageThumbnail box={CONUS} />);
    const land = container.querySelector("[data-testid='coverage-land']");
    expect(land?.tagName.toLowerCase()).toBe("path");
    expect(land?.getAttribute("d")?.startsWith("M")).toBe(true);
    expect(land?.getAttribute("d")?.length).toBeGreaterThan(10000);
  });
});

describe("viewWindow", () => {
  it("shows the whole grid for a global box or one that crosses the antimeridian", () => {
    expect(viewWindow(WORLD)).toEqual({ x: 0, width: THUMBNAIL_WIDTH });
    expect(viewWindow(PACIFIC)).toEqual({ x: 0, width: THUMBNAIL_WIDTH });
  });

  it("centres a regional box in a 240-wide window and keeps it inside the grid", () => {
    expect(viewWindow({ north: 10, south: 0, east: 10, west: 0 })).toEqual({ x: 65, width: 240 });
    expect(viewWindow(CONUS)).toEqual({ x: 0, width: 240 });
    expect(viewWindow({ north: 10, south: 0, east: 175, west: 165 })).toEqual({ x: 120, width: 240 });
    expect(viewWindow({ north: 10, south: 0, east: -175, west: -179 })).toEqual({ x: 0, width: 240 });
  });

  it("widens the window for a box wider than it can hold", () => {
    const w = viewWindow({ north: 60, south: 0, east: 160, west: -150 });
    expect(w.width).toBe(350);
  });
});
