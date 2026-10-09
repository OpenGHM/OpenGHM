import { STATUS_LABEL } from "@/components/jobs/job-status-badge";
import type { DisplayStatus } from "@/lib/jobs/display-status";
import type { StatusCount } from "@/lib/admin/types";

/** Each job status in its own hue: the `--status-*` tokens in app/globals.css,
 *  the same colours the status badge uses. */
const COLORS: Record<string, string> = {
  DRAFT: "var(--status-draft)",
  PENDING: "var(--status-pending)",
  SUBMITTED: "var(--status-submitted)",
  RUNNING: "var(--status-running)",
  COMPLETING: "var(--status-running)",
  CANCELLING: "var(--status-cancelling)",
  COMPLETED: "var(--status-completed)",
  FAILED: "var(--status-failed)",
  CANCELLED: "var(--status-cancelled)",
};
const FALLBACK = "var(--status-pending)";

const labelFor = (status: string) => STATUS_LABEL[status as DisplayStatus] ?? status;

// Horizontal stacked bar rather than a donut: 7 statuses, several often
// near-zero, and label placement inside donut slices gets cramped fast.
export function StatusBreakdownChart({ items, total }: { items: StatusCount[]; total: number }) {
  const nonZero = items.filter((i) => i.count > 0);

  if (total === 0) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        No jobs yet. They will show here as people run simulations.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
        {nonZero.map((item) => (
          <div
            key={item.status}
            style={{ width: `${(item.count / total) * 100}%`, backgroundColor: COLORS[item.status] ?? FALLBACK }}
            title={`${labelFor(item.status)}: ${item.count}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.status} className="flex items-center gap-1.5 text-xs">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: COLORS[item.status] ?? FALLBACK }}
            />
            <span className="text-muted-foreground">{labelFor(item.status)}</span>
            <span className="ml-auto font-mono font-medium text-foreground">{item.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
