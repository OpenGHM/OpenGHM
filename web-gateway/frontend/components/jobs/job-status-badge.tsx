import type { JobStatus } from "@/lib/jobs/types";

const STYLE_MAP: Record<JobStatus, string> = {
  PENDING: "bg-slate-100 text-slate-600 border-slate-200",
  SUBMITTED: "bg-blue-100 text-blue-700 border-blue-200",
  RUNNING: "bg-amber-100 text-amber-700 border-amber-200 animate-pulse",
  COMPLETING: "bg-amber-100 text-amber-700 border-amber-200",
  COMPLETED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  FAILED: "bg-red-100 text-red-700 border-red-200",
  CANCELLED: "bg-slate-100 text-slate-500 border-slate-200",
};

const LABEL_MAP: Record<JobStatus, string> = {
  PENDING: "Pending",
  SUBMITTED: "Submitted",
  RUNNING: "Running",
  COMPLETING: "Completing",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STYLE_MAP[status]}`}
    >
      {status === "RUNNING" && (
        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
      )}
      {LABEL_MAP[status]}
    </span>
  );
}
