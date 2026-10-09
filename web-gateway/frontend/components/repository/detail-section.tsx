import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A white card of a snapshot's or model input's detail page, with the design's
 * heading for its place: `main` (the wide column's 20 px title), `side` (the
 * narrow column's 17 px one) or `eyebrow` (the small mono label that opens the
 * description). `tone="navy"` is the dark card of the side column. `aside` is
 * what sits at the heading's right edge (a count); `raised` lifts the card
 * off the band it overlaps.
 */
export function DetailSection({
  title,
  heading = "main",
  tone = "light",
  aside,
  raised = false,
  className,
  children,
}: {
  title: ReactNode;
  heading?: "main" | "side" | "eyebrow";
  tone?: "light" | "navy";
  aside?: ReactNode;
  raised?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const navy = tone === "navy";
  return (
    <section
      className={cn(
        "relative flex min-w-0 flex-col rounded-card",
        navy ? "overflow-hidden bg-hero text-hero-foreground" : "bg-card text-card-foreground",
        heading === "side" ? "gap-3.5 p-6" : "gap-4 p-5 sm:px-[30px] sm:py-7",
        raised && "shadow-raised",
        className,
      )}
    >
      {navy && <div aria-hidden="true" className="hero-dots pointer-events-none absolute inset-0" />}
      <div className="relative flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2
          className={cn(
            heading === "main" && "text-xl font-semibold tracking-[-0.02em]",
            heading === "side" && "text-[17px] font-semibold tracking-[-0.02em]",
            heading === "eyebrow" &&
              "font-mono text-[13px] font-medium tracking-[0.06em] text-primary uppercase",
          )}
        >
          {title}
        </h2>
        {aside}
      </div>
      <div className="relative flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}
