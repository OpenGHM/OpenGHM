import { Hourglass } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { JobStatus } from "@/lib/jobs/types";

/** PENDING/SUBMITTED — accepted, waiting on SLURM. There is no `started_at`
 *  yet, and Anvil's scheduler exposes no queue position or ETA, so this says
 *  that plainly rather than inventing one. */
export function QueuedNoticeCard({ status }: { status: JobStatus }) {
  const label = status === "PENDING" ? "Pending" : "Submitted to Anvil";
  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardContent className="flex items-start gap-3 py-4 text-sm">
        <Hourglass className="mt-0.5 size-4 shrink-0 text-slate-500" />
        <div>
          <p className="font-medium text-foreground">{label} &mdash; waiting on SLURM</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Accepted, not yet started. SLURM does not report a queue position
            or an estimated start time, so none is shown here — this panel
            will update once the job starts running.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
