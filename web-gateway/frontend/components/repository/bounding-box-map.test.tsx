import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import L from "leaflet";
import { BoundingBoxMap } from "./bounding-box-map";

afterEach(cleanup);

// Leaflet's CSS names its marker and layers-control images by a path that does
// not survive bundling (`Icon.Default` cannot find `marker-icon.png` once the
// bundler hashes the file name, and falls back to a relative URL that 404s).
// That only bites if a marker or the layers control is ever created, so the
// map must draw the rectangle and nothing else.
describe("BoundingBoxMap", () => {
  it("draws the bounding box without a marker, so no default icon is requested", () => {
    const { container } = render(
      <BoundingBoxMap north={49} south={24} east={-66} west={-125} />,
    );

    expect(container.querySelector(".leaflet-container")).not.toBeNull();
    expect(container.querySelector("path.leaflet-interactive")).not.toBeNull();
    expect(container.querySelector(".leaflet-marker-icon")).toBeNull();
    expect(container.querySelector(".leaflet-marker-shadow")).toBeNull();
    expect(container.querySelector(".leaflet-control-layers")).toBeNull();
    // Set only by `Icon.Default` when it first builds an icon URL.
    expect((L.Icon.Default as unknown as { imagePath?: string }).imagePath).toBeUndefined();
  });
});
