"use client";

import dynamic from "next/dynamic";

const BoundingBoxMap = dynamic(
  () => import("./bounding-box-map").then((m) => m.BoundingBoxMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[240px] w-full items-center justify-center rounded-lg bg-slate-100 text-sm text-muted-foreground">
        Loading map…
      </div>
    ),
  }
);

export { BoundingBoxMap };
