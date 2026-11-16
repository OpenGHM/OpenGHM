"use client";

import dynamic from "next/dynamic";

/** Leaflet touches `window`, so the map is client-only, like the bounding-box map. */
export const OutputMap = dynamic(() => import("./output-map").then((m) => m.OutputMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[460px] w-full items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
});
