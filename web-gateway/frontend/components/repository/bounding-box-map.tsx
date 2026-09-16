"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Rectangle, useMap } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";

/** Inner component: once the map is mounted, fit it exactly to the bbox with padding. */
function FitBounds({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 10 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return null;
}

interface Props {
  north: number;
  south: number;
  east: number;
  west: number;
}

export function BoundingBoxMap({ north, south, east, west }: Props) {
  const bounds: LatLngBoundsExpression = [
    [south, west],
    [north, east],
  ];

  // Approximate initial center — immediately overridden by FitBounds on mount.
  const center: [number, number] = [(north + south) / 2, (east + west) / 2];

  return (
    <MapContainer
      center={center}
      zoom={2}
      minZoom={1}
      scrollWheelZoom={false}
      // No maxBounds — it prevents fitBounds from centering correctly when the
      // bbox center is near the antimeridian (world pixel < container half-width).
      style={{
        height: "340px",
        width: "100%",
        borderRadius: "0.5rem",
        background: "#aad3df", // OSM ocean color — fills any empty space gracefully
      }}
      zoomControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        noWrap={true}
        bounds={[[-90, -180], [90, 180]]}
      />
      <Rectangle
        bounds={bounds}
        pathOptions={{
          color: "#006994",
          weight: 2,
          fillColor: "#006994",
          fillOpacity: 0.18,
        }}
      />
      <FitBounds bounds={bounds} />
    </MapContainer>
  );
}
