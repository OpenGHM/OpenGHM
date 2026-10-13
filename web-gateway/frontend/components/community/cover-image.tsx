"use client";

import { useCallback, useEffect, useRef } from "react";
import { CmsImage } from "@/components/community/cms-image";
import { cn } from "@/lib/utils";

/** From this width over height a cover counts as a wide banner. */
const WIDE_RATIO = 1.9;

/**
 * A workshop cover, shown whole. Once the picture has loaded it sets
 * `data-wide` on itself (true for a banner), so the card around it can lay
 * out for the picture's shape in CSS: `group-has-[[data-wide=true]]:` and
 * `has-[[data-wide=true]]:` on an ancestor. Until then it counts as not wide.
 * A blurred copy behind it fills what the picture leaves, rather than a flat
 * band. Draws nothing for an address that is not safe to load.
 */
export function CoverImage({
  src,
  alt,
  loading,
  className,
}: {
  src: string | null | undefined;
  alt?: string;
  loading?: "eager" | "lazy";
  /** Classes for the picture itself. */
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

  return (
    <>
      <CmsImage
        src={src}
        alt=""
        aria-hidden="true"
        loading={loading}
        className="absolute inset-0 -z-10 size-full scale-110 object-cover opacity-60 blur-2xl"
      />
      <CmsImage
        ref={ref}
        src={src}
        alt={alt}
        loading={loading}
        onLoad={(e) => mark(e.currentTarget)}
        className={cn("block", className)}
      />
    </>
  );
}
