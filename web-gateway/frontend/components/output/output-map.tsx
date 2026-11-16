"use client";

import { useEffect } from "react";
import { CircleMarker, ImageOverlay, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import type { OutputBounds } from "@/lib/repository/output";
import type { ViewPoint } from "@/lib/output/view";

interface Props {
  /** The grid, for the first view and for what a click may pick. */
  grid: OutputBounds;
  /** The PNG as a data URL and the box it was drawn for; null until the first one arrives. */
  image: { url: string; bbox: OutputBounds } | null;
  point: ViewPoint | null;
  onPick: (point: ViewPoint) => void;
}

function bounds(b: OutputBounds): LatLngBoundsExpression {
  return [
    [b.south, b.west],
    [b.north, b.east],
  ];
}

function FitGrid({ grid }: { grid: OutputBounds }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds(grid), { padding: [16, 16], maxZoom: 10 });
    // Fit once, when the map is made: a later view the person set is theirs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return null;
}

function Picker({ grid, onPick }: { grid: OutputBounds; onPick: (p: ViewPoint) => void }) {
  useMapEvents({
    click(event) {
      const { lat, lng } = event.latlng;
      if (lng < grid.west || lng > grid.east || lat < grid.south || lat > grid.north) return;
      onPick({ lon: lng, lat });
    },
  });
  return null;
}

/**
 * One whole-domain PNG over the Leaflet map (nearest-neighbour: the cells as
 * they are, not smoothed), and a ring on the clicked cell. There is no
 * re-render on zoom; a zoomed Global grid shows its cells.
 */
export function OutputMap({ grid, image, point, onPick }: Props) {
  const center: [number, number] = [(grid.north + grid.south) / 2, (grid.east + grid.west) / 2];
  return (
    <MapContainer
      center={center}
      zoom={2}
      minZoom={1}
      scrollWheelZoom={false}
      className="output-map"
      style={{ height: "460px", width: "100%", borderRadius: "0.75rem", background: "var(--map-water)" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        noWrap={true}
        bounds={[
          [-90, -180],
          [90, 180],
        ]}
      />
      {image && <ImageOverlay url={image.url} bounds={bounds(image.bbox)} opacity={0.85} className="output-pixelated" />}
      {point && (
        <CircleMarker
          center={[point.lat, point.lon]}
          radius={7}
          pathOptions={{ color: "#111827", weight: 2, fillColor: "#ffffff", fillOpacity: 0.7 }}
        />
      )}
      <FitGrid grid={grid} />
      <Picker grid={grid} onPick={onPick} />
    </MapContainer>
  );
}
