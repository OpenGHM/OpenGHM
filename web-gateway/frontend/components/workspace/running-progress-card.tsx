import { Activity } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { FakeProgress } from "@/lib/workspace/fixtures";

/**
 * RUNNING/COMPLETING — elapsed vs. requested walltime, and the stage a WBM
 * run's own stdout would report. SLURM has no notion of "percent done" for
 * an arbitrary job, so the bar is explicitly captioned as elapsed time, not
 * work completed.
 *
 * `progress` is undefined for a real running job: nothing derives a stage
 * from the backend today, and no real job currently reaches RUNNING (dev
 * jobs only ever get to DRAFT or FAILED), so this renders a plain waiting
 * state rather than a fabricated bar.
 */
export function RunningProgressCard({
  progress,
  startedAt,
}: {
  progress?: FakeProgress;
  startedAt: string | null;
}) {
  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-r from-amber-500/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10">
            <Activity className="size-4 text-amber-600" />
          </div>
          Progress
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-5 pb-6">
        {progress ? (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{progress.stage}</span>
              <span>
                {progress.elapsed} / {progress.requested}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-amber-500 transition-all"
                style={{ width: `${Math.min(100, Math.round(progress.fraction * 100))}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Elapsed vs. requested walltime — SLURM reports no true percent-done
              for a running job, so this is a proxy, not a measure of work completed.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {startedAt ? `Running since ${new Date(startedAt).toLocaleString()}.` : "Running."}{" "}
            No stage or walltime progress is available yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
