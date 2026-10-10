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
