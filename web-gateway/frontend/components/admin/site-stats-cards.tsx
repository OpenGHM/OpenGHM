import { Card, CardContent } from "@/components/ui/card";
import type { JobStatsResponse } from "@/lib/jobs/types";

function StatCard({ label, value, colorClass }: { label: string; value: number; colorClass: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
        <p className="text-sm text-slate-500">{label}</p>
      </CardContent>
    </Card>
  );
}

export function SiteStatsCards({ stats }: { stats: JobStatsResponse }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <StatCard label="Total jobs (all users)" value={stats.total} colorClass="text-slate-900" />
      <StatCard label="Running" value={stats.running} colorClass="text-amber-600" />
      <StatCard label="Completed" value={stats.completed} colorClass="text-emerald-600" />
      <StatCard label="Failed" value={stats.failed} colorClass="text-red-600" />
    </div>
  );
}
