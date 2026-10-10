import type { ComponentProps } from "react";
import { safeImageSrc } from "@/lib/community/links";

/**
 * An image an admin put in the Community CMS. Its address is whatever the
 * content holds: an `https://` address on any host, or `/api/community/files/<id>`
 * for an upload. `next/image` would need every host listed in next.config.ts
 * and would re-encode the bytes through `/_next/image`; an editor's picture is
 * shown as uploaded, so this is a plain `<img>`, the one place that is. It
 * draws nothing for an address that is not safe to load.
 */
export function CmsImage({
  src,
  alt,
  ...props
}: Omit<ComponentProps<"img">, "src" | "alt"> & { src: string | null | undefined; alt?: string }) {
  const safe = safeImageSrc(src);
  if (!safe) return null;
  // eslint-disable-next-line @next/next/no-img-element -- see the comment above
  return <img src={safe} alt={alt ?? ""} loading="lazy" decoding="async" {...props} />;
}

/**
 * A workshop cover at the picture's own shape, never cropped. A wide banner
 * fills the width; a picture that reaches `imgClassName`'s height cap is
 * centred, and a blurred copy of itself fills the sides rather than a flat
 * band. Draws nothing for an address that is not safe to load.
 */
export function CoverImage({
  src,
  alt,
  imgClassName,
  loading,
}: {
  src: string | null | undefined;
  alt?: string;
  /** The height cap, e.g. `max-h-[420px]`. */
  imgClassName: string;
  loading?: "eager" | "lazy";
}) {
  if (!safeImageSrc(src)) return null;
  return (
    <div className="relative isolate overflow-hidden rounded-[18px] bg-accent">
      <CmsImage
        src={src}
        alt=""
        aria-hidden="true"
        loading={loading}
        className="absolute inset-0 -z-10 size-full scale-110 object-cover opacity-60 blur-2xl"
      />
      <CmsImage
        src={src}
        alt={alt}
        loading={loading}
        className={`mx-auto block h-auto w-auto max-w-full ${imgClassName}`}
      />
    </div>
  );
}
