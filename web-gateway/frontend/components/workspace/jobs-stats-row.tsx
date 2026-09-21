import Link from "next/link";
import type { JobStatsResponse } from "@/lib/jobs/types";

interface StatChipProps {
  label: string;
  value: number;
  href: string;
  colorClass: string;
}

function StatChip({ label, value, href, colorClass }: StatChipProps) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/10 px-4 py-2.5 backdrop-blur-sm transition-colors hover:bg-white/20"
    >
      <span className={`text-xl font-bold ${colorClass}`}>{value}</span>
      <span className="text-sm text-white/80">{label}</span>
    </Link>
  );
}

export function JobsStatsRow({ stats }: { stats: JobStatsResponse }) {
  return (
    <div className="flex flex-wrap gap-3">
      <StatChip
        label="Total"
        value={stats.total}
        href="/workspace"
        colorClass="text-white"
      />
      <StatChip
        label="Running"
        value={stats.running}
        href="/workspace?status=active"
        colorClass="text-amber-300"
      />
      <StatChip
        label="Completed"
        value={stats.completed}
        href="/workspace?status=COMPLETED"
        colorClass="text-emerald-300"
      />
      <StatChip
        label="Failed"
        value={stats.failed}
        href="/workspace?status=FAILED"
        colorClass="text-red-300"
      />
    </div>
  );
}
