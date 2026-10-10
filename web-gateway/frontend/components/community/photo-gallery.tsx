"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { CmsImage } from "@/components/community/cms-image";
import { countLabel } from "@/lib/community/format";
import { safeImageSrc } from "@/lib/community/links";
import type { WorkshopPhoto } from "@/lib/community/types";

const LIGHTBOX_BUTTON =
  "grid size-11 place-items-center rounded-xl bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-hero-eyebrow focus-visible:outline-none";

/**
 * A workshop's photos: a grid of thumbnails and, when one is opened, a
 * lightbox over the page with Close, Previous and Next buttons, a "n / N"
 * count and the photo's caption. It is a Radix Dialog, so focus stays inside
 * while it is open, Escape closes it, and focus goes back to the thumbnail you
 * ended on. The arrow keys step through the photos (the last wraps to the
 * first), and so do the buttons. A click anywhere but on the picture, the
 * buttons or the caption closes it.
 */
export function PhotoGallery({ photos: all }: { photos: WorkshopPhoto[] }) {
  // A photo whose address is not safe to load is left out, count and all.
  const photos = all.filter((p) => safeImageSrc(p.url));
  const [open, setOpen] = useState<number | null>(null);
  const thumbs = useRef<(HTMLButtonElement | null)[]>([]);
  const last = useRef(0);
  if (photos.length === 0) return null;

  const total = photos.length;
  const step = (by: number) =>
    setOpen((i) => {
      const next = (((i ?? 0) + by) % total + total) % total;
      last.current = next;
      return next;
    });
  const show = (i: number) => {
    last.current = i;
    setOpen(i);
  };
  const photo = open === null ? null : photos[open];

  return (
    <section aria-labelledby="photos-heading" className="flex flex-col gap-4 rounded-card bg-card p-6 shadow-card sm:px-[30px] sm:py-7">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="photos-heading" className="text-xl font-semibold tracking-[-0.02em]">
          Photos
        </h2>
        <span className="font-mono text-[12.5px] text-muted-foreground">{countLabel(total, "photo")}</span>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(200px,100%),1fr))] gap-2">
        {photos.map((p, i) => (
          <li key={`${i}-${p.url}`}>
            <button
              type="button"
              ref={(el) => {
                thumbs.current[i] = el;
              }}
              onClick={() => show(i)}
              aria-haspopup="dialog"
              aria-label={`Open photo ${i + 1} of ${total}${p.caption ? `: ${p.caption}` : ""}`}
              title={p.caption ?? undefined}
              className="block aspect-[4/3] w-full cursor-zoom-in overflow-hidden rounded-[14px] bg-accent transition-transform focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none motion-safe:hover:scale-[0.985]"
            >
              <CmsImage src={p.url} alt="" className="block size-full object-cover" />
            </button>
          </li>
        ))}
      </ul>

      <Dialog.Root open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-hero/95" />
          <Dialog.Content
            onKeyDown={(e) => {
              if (total < 2) return;
              if (e.key === "ArrowRight") {
                e.preventDefault();
                step(1);
              } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                step(-1);
              }
            }}
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest("[data-keep]")) setOpen(null);
            }}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              thumbs.current[last.current]?.focus();
            }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3.5 px-4 py-16 outline-none sm:px-[72px]"
          >
            <Dialog.Title className="sr-only">
              Photo {(open ?? 0) + 1} of {total}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              {photo?.caption || "A photo from this workshop."} Use the left and right arrow keys for the other photos.
            </Dialog.Description>
            {photo && (
              <>
                <div data-keep className="flex max-w-full">
                  <CmsImage
                    key={open}
                    src={photo.url}
                    alt={photo.caption || `Photo ${(open ?? 0) + 1} of ${total}`}
                    loading="eager"
                    className="block max-h-[calc(100dvh-170px)] max-w-full rounded-xl object-contain"
                  />
                </div>
                <p data-keep aria-live="polite" className="flex flex-wrap items-baseline justify-center gap-x-4 gap-y-1 text-center text-sm text-hero-text">
                  <span className="font-mono text-hero-eyebrow">
                    {(open ?? 0) + 1} / {total}
                  </span>
                  {photo.caption && <span>{photo.caption}</span>}
                </p>
              </>
            )}
            <Dialog.Close data-keep aria-label="Close" className={`${LIGHTBOX_BUTTON} absolute top-4 right-4`}>
              <X aria-hidden="true" className="size-5" />
            </Dialog.Close>
            {total > 1 && (
              <>
                <button
                  type="button"
                  data-keep
                  aria-label="Previous photo"
                  onClick={() => step(-1)}
                  className={`${LIGHTBOX_BUTTON} absolute top-1/2 left-3 -translate-y-1/2`}
                >
                  <ChevronLeft aria-hidden="true" className="size-5" />
                </button>
                <button
                  type="button"
                  data-keep
                  aria-label="Next photo"
                  onClick={() => step(1)}
                  className={`${LIGHTBOX_BUTTON} absolute top-1/2 right-3 -translate-y-1/2`}
                >
                  <ChevronRight aria-hidden="true" className="size-5" />
                </button>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
