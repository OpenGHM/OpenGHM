import Link from "next/link";
import { Clock, Cpu, Calendar } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { TimeStamp } from "@/components/common/time-stamp";
import { ClampedName } from "@/components/common/clamped-name";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { displayStatus } from "@/lib/jobs/display-status";
import type { Job } from "@/lib/jobs/types";

function formatDuration(startedAt: string, completedAt: string): string {
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function DraftCard({ job }: { job: Job }) {
  const shown = displayStatus(job);
  const displayId = job.sim_id || job.id.slice(0, 12);

  return (
    <Link href={`/workspace/${job.id}`} className="block">
      <Card
        className="gap-0 overflow-hidden py-0 transition-all hover:-translate-y-0.5 hover:shadow-raised"
      >
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <ClampedName as="p" lines={1} className="text-base font-semibold text-foreground">
                {job.dataset_title}
              </ClampedName>
              <code className="mt-0.5 block font-mono text-xs text-muted-foreground">
                {displayId}
              </code>
            </div>
            <JobStatusBadge status={shown} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="size-3.5" aria-hidden="true" />
              <TimeStamp value={job.created_at} format="date" />
            </span>

            {job.started_at && job.completed_at && (
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" />
                {formatDuration(job.started_at, job.completed_at)}
              </span>
            )}

            {job.slurm_job_id && (
              <span className="flex items-center gap-1">
                <Cpu className="size-3.5" />
                Slurm&nbsp;#{job.slurm_job_id}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
