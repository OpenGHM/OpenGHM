import Link from "next/link";
import type { JobStatsResponse } from "@/lib/jobs/types";

interface StatChipProps {
  label: string;
  value: number;
  href: string;
  /** A small dot in the status's hue; none for the total. */
  dotClass?: string;
}

function StatChip({ label, value, href, dotClass }: StatChipProps) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/10 px-4 py-2.5 backdrop-blur-sm transition-colors hover:bg-white/20"
    >
      {dotClass && (
        <span aria-hidden="true" className={`size-2 rounded-full ring-2 ring-white/70 ${dotClass}`} />
      )}
      <span className="text-xl font-bold text-white">{value}</span>
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
      />
      <StatChip
        label="Running"
        value={stats.running}
        href="/workspace?status=active"
        dotClass="bg-status-running"
      />
      <StatChip
        label="Completed"
        value={stats.completed}
        href="/workspace?status=COMPLETED"
        dotClass="bg-status-completed"
      />
      <StatChip
        label="Failed"
        value={stats.failed}
        href="/workspace?status=FAILED"
        dotClass="bg-status-failed"
      />
    </div>
  );
}
