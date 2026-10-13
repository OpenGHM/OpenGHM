"use client";

import { useCallback, useEffect, useRef } from "react";
import { CmsImage } from "@/components/community/cms-image";
import { cn } from "@/lib/utils";

/** From this width over height a cover counts as a wide banner. */
const WIDE_RATIO = 1.9;

/**
 * A workshop cover, shown whole at its own shape. Once the picture has loaded
 * it sets `data-wide` on itself (true for a banner), so the card around it can
 * lay out for the shape in CSS with `has-[[data-wide=true]]:` on an ancestor.
 * Until then it counts as not wide. Draws nothing for an address that is not
 * safe to load.
 */
export function CoverImage({
  src,
  alt,
  className,
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const mark = useCallback((img: HTMLImageElement) => {
    if (img.naturalWidth > 0) img.dataset.wide = String(img.naturalWidth / img.naturalHeight >= WIDE_RATIO);
  }, []);
  // A picture that finished loading before this hydrated has no load event left.
  useEffect(() => {
    if (ref.current?.complete) mark(ref.current);
  }, [mark]);

  return <CmsImage ref={ref} src={src} alt={alt} onLoad={(e) => mark(e.currentTarget)} className={cn("block", className)} />;
}
