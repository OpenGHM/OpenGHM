"use client";

import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A small spinner for the `<Link>` it sits in: shown while the navigation that
 * link started is pending, and only once that has taken a moment
 * (`reveal-delayed`), so a quick page change shows nothing. The page it leaves
 * stays on screen meanwhile; this is the one sign that the click was heard.
 *
 * Lays itself over the top-right corner of the link, which must be `relative`,
 * so the link does not change size. Decorative: the pending state is not
 * announced, because the page itself is not busy.
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      data-slot="link-pending"
      aria-hidden="true"
      className={cn(
        "reveal-delayed pointer-events-none absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-white text-primary shadow-sm ring-1 ring-black/10",
        className
      )}
    >
      <Loader2 className="size-3 motion-safe:animate-spin" />
    </span>
  );
}
