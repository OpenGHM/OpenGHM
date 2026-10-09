import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { HUE } from "@/lib/jobs/status-hue";
import type { JobStatsResponse } from "@/lib/jobs/types";

export function StatCard({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <Card className="gap-2 py-5">
      <CardContent className="px-5">
        <p className="font-mono text-[11.5px] tracking-[0.06em] text-muted-foreground uppercase">{label}</p>
        <p
          className={cn(
            "mt-2 text-2xl font-bold tracking-[-0.03em] text-foreground [overflow-wrap:anywhere]",
            valueClass
          )}
        >
          {value}
        </p>
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
