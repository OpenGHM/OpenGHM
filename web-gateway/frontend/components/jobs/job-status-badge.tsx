import type { DisplayStatus } from "@/lib/jobs/display-status";
import { HUE } from "@/lib/jobs/status-hue";

/** The words for each status, for the badge and for announcements. */
export const STATUS_LABEL: Record<DisplayStatus, string> = {
  DRAFT: "Editing",
  PENDING: "Pending",
  SUBMITTED: "Submitted",
  RUNNING: "Running",
  COMPLETING: "Completing",
  CANCELLING: "Cancelling",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

/** Takes the status to *show*: pass `displayStatus(job)`, so a job whose cancel
 *  is waiting on SLURM reads "Cancelling" wherever a badge appears. */
export function JobStatusBadge({ status }: { status: DisplayStatus }) {
  const active = status === "RUNNING" || status === "CANCELLING";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${HUE[status].badge} ${
        active ? "motion-safe:animate-pulse" : ""
      }`}
    >
      {active && (
        <span
          aria-hidden="true"
          className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current"
        />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * The status as a dot and a word in the status's colour, with no box around
 * it: for a list row, where a badge on every line is heavier than the status
 * deserves. Takes the status to *show*, like `JobStatusBadge`. A running or
 * cancelling job's dot pulses (not under reduced motion).
 */
export function JobStatusDot({ status, className }: { status: DisplayStatus; className?: string }) {
  const active = status === "RUNNING" || status === "CANCELLING";
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${HUE[status].icon} ${className ?? ""}`}>
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full bg-current ${active ? "motion-safe:animate-pulse" : ""}`}
      />
      {STATUS_LABEL[status]}
    </span>
  );
}
