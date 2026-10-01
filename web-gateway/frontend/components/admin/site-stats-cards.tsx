import { Card, CardContent } from "@/components/ui/card";
import { HUE } from "@/lib/jobs/status-hue";
import type { JobStatsResponse } from "@/lib/jobs/types";

export function StatCard({
  label,
  value,
  valueClass = "text-slate-900",
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className={`text-2xl font-bold ${valueClass}`}>{value}</p>
        <p className="text-sm text-slate-500">{label}</p>
      </CardContent>
    </Card>
  );
}

/** The overview's figures. `null` for either means that figure could not be
 *  loaded: a dash, never a zero that looks like an answer. */
export function SiteStatsCards({
  stats,
  userCount,
}: {
  stats: JobStatsResponse | null;
  userCount: number | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      <StatCard label="Total users" value={userCount ?? "—"} />
      <StatCard label="Total jobs" value={stats?.total ?? "—"} />
      <StatCard label="Running" value={stats?.running ?? "—"} valueClass={HUE.RUNNING.icon} />
      <StatCard label="Completed" value={stats?.completed ?? "—"} valueClass={HUE.COMPLETED.icon} />
      <StatCard label="Failed" value={stats?.failed ?? "—"} valueClass={HUE.FAILED.icon} />
    </div>
  );
}
