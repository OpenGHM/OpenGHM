import type { DisplayStatus } from "@/lib/jobs/display-status";
import type { FailureTone } from "@/lib/workspace/failure-copy";

/**
 * Tailwind classes for each status hue, from the `--status-*` tokens in
 * app/globals.css. Written out in full because Tailwind finds classes by
 * reading source text, not by building them.
 */
export interface HueClasses {
  /** The badge: tint, text and border. */
  badge: string;
  /** A card header's gradient, for `bg-gradient-to-r`. */
  gradient: string;
  /** The icon tile behind the header icon. */
  tile: string;
  /** The header icon and other accent text. */
  icon: string;
  /** A notice box in this hue. */
  box: string;
}

export const HUE: Record<DisplayStatus, HueClasses> = {
  DRAFT: {
    badge: "border-status-draft/25 bg-status-draft/10 text-status-draft",
    gradient: "from-status-draft/5",
    tile: "bg-status-draft/10",
    icon: "text-status-draft",
    box: "border-status-draft/25 bg-status-draft/5",
  },
  PENDING: {
    badge: "border-status-pending/25 bg-status-pending/10 text-status-pending",
    gradient: "from-status-pending/5",
    tile: "bg-status-pending/10",
    icon: "text-status-pending",
    box: "border-status-pending/25 bg-status-pending/5",
  },
  SUBMITTED: {
    badge: "border-status-submitted/25 bg-status-submitted/10 text-status-submitted",
    gradient: "from-status-submitted/5",
    tile: "bg-status-submitted/10",
    icon: "text-status-submitted",
    box: "border-status-submitted/25 bg-status-submitted/5",
  },
  RUNNING: {
    badge: "border-status-running/25 bg-status-running/10 text-status-running",
    gradient: "from-status-running/5",
    tile: "bg-status-running/10",
    icon: "text-status-running",
    box: "border-status-running/25 bg-status-running/5",
  },
  COMPLETING: {
    badge: "border-status-running/25 bg-status-running/10 text-status-running",
    gradient: "from-status-running/5",
    tile: "bg-status-running/10",
    icon: "text-status-running",
    box: "border-status-running/25 bg-status-running/5",
  },
  CANCELLING: {
    badge: "border-status-cancelling/25 bg-status-cancelling/10 text-status-cancelling",
    gradient: "from-status-cancelling/5",
    tile: "bg-status-cancelling/10",
    icon: "text-status-cancelling",
    box: "border-status-cancelling/25 bg-status-cancelling/5",
  },
  COMPLETED: {
    badge: "border-status-completed/25 bg-status-completed/10 text-status-completed",
    gradient: "from-status-completed/5",
    tile: "bg-status-completed/10",
    icon: "text-status-completed",
    box: "border-status-completed/25 bg-status-completed/5",
  },
  FAILED: {
    badge: "border-status-failed/25 bg-status-failed/10 text-status-failed",
    gradient: "from-status-failed/5",
    tile: "bg-status-failed/10",
    icon: "text-status-failed",
    box: "border-status-failed/25 bg-status-failed/5",
  },
  CANCELLED: {
    badge: "border-status-cancelled/25 bg-status-cancelled/10 text-status-cancelled",
    gradient: "from-status-cancelled/5",
    tile: "bg-status-cancelled/10",
    icon: "text-status-cancelled",
    box: "border-status-cancelled/25 bg-status-cancelled/5",
  },
};

/** The hue for a failure's tone: `danger` reads as failed, `warning` as a limit
 *  hit, `neutral` as not the owner's doing. */
export const TONE_HUE: Record<FailureTone, DisplayStatus> = {
  danger: "FAILED",
  warning: "RUNNING",
  neutral: "CANCELLED",
};
