import type { DisplayStatus } from "@/lib/jobs/display-status";
import { HUE } from "@/lib/jobs/status-hue";

const LABEL_MAP: Record<DisplayStatus, string> = {
  DRAFT: "Draft",
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
      {LABEL_MAP[status]}
    </span>
  );
}
