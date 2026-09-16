import type { StatusCount } from "@/lib/admin/types";

const COLORS: Record<string, string> = {
  PENDING: "var(--chart-3)",
  SUBMITTED: "var(--chart-2)",
  RUNNING: "var(--chart-4)",
  COMPLETING: "var(--chart-4)",
  COMPLETED: "var(--chart-2)",
  FAILED: "var(--chart-5)",
  CANCELLED: "var(--chart-3)",
};

// Horizontal stacked bar rather than a donut: 7 statuses, several often
// near-zero, and label placement inside donut slices gets cramped fast.
export function StatusBreakdownChart({ items, total }: { items: StatusCount[]; total: number }) {
  const nonZero = items.filter((i) => i.count > 0);

  if (total === 0) {
    return <p className="text-sm text-slate-500">No jobs yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-100">
        {nonZero.map((item) => (
          <div
            key={item.status}
            style={{ width: `${(item.count / total) * 100}%`, backgroundColor: COLORS[item.status] ?? "var(--chart-1)" }}
            title={`${item.status}: ${item.count}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.status} className="flex items-center gap-1.5 text-xs">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: COLORS[item.status] ?? "var(--chart-1)" }}
            />
            <span className="text-slate-600">{item.status}</span>
            <span className="ml-auto font-medium text-slate-900">{item.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
