import type { WorkshopStatus } from "@/lib/community/types";
import { cn } from "@/lib/utils";

/**
 * "Upcoming" (green) or "Past event" (grey), with its dot. `on="hero"` is for
 * the navy band: the pill is drawn on a white one so the status colours,
 * made for a light surface, stay readable.
 */
export function StatusPill({
  status,
  label,
  on = "card",
}: {
  status: WorkshopStatus;
  /** The words, when the place calls it something else ("Next workshop"). */
  label?: string;
  on?: "card" | "hero";
}) {
  const upcoming = status === "upcoming";
  const pill = (
    <span
      className={cn(
        "inline-flex items-center gap-[7px] rounded-full px-[11px] py-[5px] text-[12.5px] font-semibold",
        upcoming ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-[7px] rounded-full", upcoming ? "bg-success" : "bg-muted-foreground/60")}
      />
      {label ?? (upcoming ? "Upcoming" : "Past event")}
    </span>
  );
  return on === "hero" ? <span className="inline-flex rounded-full bg-white">{pill}</span> : pill;
}

/** "Online", "In person", "Hybrid": a workshop's format. `on="hero"` is for the navy band. */
export function FormatPill({
  children,
  on = "card",
  small = false,
}: {
  children: string;
  on?: "card" | "hero";
  small?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold",
        small ? "px-[9px] py-0.5 text-xs" : "px-[11px] py-[5px] text-[12.5px]",
        on === "hero"
          ? "border border-white/16 bg-white/8 text-hero-text"
          : "bg-muted text-foreground/80",
      )}
    >
      {children}
    </span>
  );
}
