"use client";

import dynamic from "next/dynamic";

const BoundingBoxMap = dynamic(
  () => import("./bounding-box-map").then((m) => m.BoundingBoxMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[280px] w-full items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground">
        Loading map…
      </div>
    ),
  }
);

export { BoundingBoxMap };
