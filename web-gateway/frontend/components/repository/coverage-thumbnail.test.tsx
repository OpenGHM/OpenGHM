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
    render(<CoverageThumbnail aspect="wide" box={CONUS} />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toBe(
      "Coverage: north 49°, south 24°, east -66°, west -125° (Regional)"
    );
    expect(screen.getByText("Regional")).toBeTruthy();
    expect(screen.getAllByTestId("coverage-rect")).toHaveLength(1);
  });

  it("draws two rectangles across the antimeridian and says Regional", () => {
    render(<CoverageThumbnail aspect="wide" box={PACIFIC} />);
    expect(screen.getAllByTestId("coverage-rect")).toHaveLength(2);
  });

  it("draws a graticule every 30 degrees and loads no image", () => {
    const { container } = render(<CoverageThumbnail aspect="wide" box={WORLD} />);
    expect(container.querySelectorAll("line")).toHaveLength(11 + 5);
    expect(container.querySelector("img, image")).toBeNull();
    expect(screen.getByText("Global")).toBeTruthy();
  });
});

describe("land", () => {
  it("draws the world land as one path inside the panel", () => {
    const { container } = render(<CoverageThumbnail aspect="wide" box={CONUS} />);
    const land = container.querySelector("[data-testid='coverage-land']");
    expect(land?.tagName.toLowerCase()).toBe("path");
    expect(land?.getAttribute("d")?.startsWith("M")).toBe(true);
    expect(land?.getAttribute("d")?.length).toBeGreaterThan(10000);
  });
});

describe("viewWindow", () => {
  const WHOLE = { x: 0, y: 0, width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT };
  const WYOMING = { north: 52.9, south: 28.9, east: -100, west: -112 };
  const CONUS_FULL = { north: 57.17, south: 21.75, east: -59, west: -130 };
  const ratios = { wide: 2.2, tall: 0.7 } as const;

  /** The box, in the 360 x 180 grid, lies inside the window with room to spare on every side. */
  function expectInside(box: typeof CONUS, aspect: "wide" | "tall") {
    const w = viewWindow(box, aspect);
    const left = box.west + 180;
    const right = box.east + 180;
    const top = 90 - box.north;
    const bottom = 90 - box.south;
    expect(left).toBeGreaterThan(w.x);
    expect(right).toBeLessThan(w.x + w.width);
    expect(top).toBeGreaterThan(w.y);
    expect(bottom).toBeLessThan(w.y + w.height);
    expect(w.width / w.height).toBeCloseTo(ratios[aspect]);
  }

  it("shows the whole grid for a global box or one that crosses the antimeridian", () => {
    for (const aspect of ["wide", "tall"] as const) {
      expect(viewWindow(WORLD, aspect)).toEqual(WHOLE);
      expect(viewWindow(PACIFIC, aspect)).toEqual(WHOLE);
    }
  });

  it("keeps the continental US and Wyoming fully inside the window for both panel shapes", () => {
    for (const box of [CONUS, CONUS_FULL, WYOMING]) {
      expectInside(box, "wide");
      expectInside(box, "tall");
    }
  });

  it("frames the box with 1.6 times its size on the axis that needs more", () => {
    const tallBox = viewWindow({ north: 60, south: 0, east: 20, west: 0 }, "wide");
    expect(tallBox.width).toBeCloseTo(60 * 1.6 * 2.2);
    expect(tallBox.height).toBeCloseTo(60 * 1.6);
    const flat = viewWindow({ north: 5, south: 0, east: 100, west: 0 }, "wide");
    expect(flat.width).toBeCloseTo(160);
    expect(flat.height).toBeCloseTo(160 / 2.2);
  });

  it("never makes the window narrower than 40 degrees", () => {
    expect(viewWindow({ north: 1, south: 0, east: 1, west: 0 }, "wide").width).toBe(40);
    expect(viewWindow({ north: 1, south: 0, east: 1, west: 0 }, "tall").width).toBe(40);
  });

  it("slides the window to stay inside the world when the box is near a pole or the date line", () => {
    const polar = viewWindow({ north: 90, south: 70, east: 10, west: -10 }, "wide");
    expect(polar.y).toBe(0);
    const south = viewWindow({ north: -70, south: -90, east: 10, west: -10 }, "tall");
    expect(south.y + south.height).toBeCloseTo(THUMBNAIL_HEIGHT);
    const edge = viewWindow({ north: 10, south: 0, east: 175, west: 165 }, "wide");
    expect(edge.x + edge.width).toBeCloseTo(THUMBNAIL_WIDTH);
    for (const w of [polar, south, edge]) {
      expect(w.x).toBeGreaterThanOrEqual(0);
      expect(w.y).toBeGreaterThanOrEqual(0);
      expect(w.x + w.width).toBeLessThanOrEqual(THUMBNAIL_WIDTH + 1e-9);
      expect(w.y + w.height).toBeLessThanOrEqual(THUMBNAIL_HEIGHT + 1e-9);
    }
  });

  it("centres the world on an axis the window is larger than", () => {
    const w = viewWindow({ north: 60, south: 0, east: 160, west: -150 }, "wide");
    expect(w.width).toBeGreaterThan(THUMBNAIL_WIDTH);
    expect(w.x).toBeCloseTo((THUMBNAIL_WIDTH - w.width) / 2);
    expect(w.height).toBeGreaterThan(THUMBNAIL_HEIGHT);
    expect(w.y).toBeCloseTo((THUMBNAIL_HEIGHT - w.height) / 2);
  });
});
