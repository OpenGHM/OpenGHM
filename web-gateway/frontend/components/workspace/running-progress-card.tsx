"use client";

import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLiveJobContext } from "@/components/workspace/live-job-provider";
import { HUE } from "@/lib/jobs/status-hue";
import { formatDuration } from "@/lib/workspace/time";
import { describeProgress, elapsedSeconds, walltimeUsed, type WalltimeTone } from "@/lib/workspace/run-progress";
import { useNow } from "@/lib/workspace/use-now";

const TONE_BAR: Record<WalltimeTone, string> = {
  normal: "bg-primary",
  warning: "bg-status-running",
  critical: "bg-status-failed",
};

function Bar({
  percent,
  label,
  valueText,
  barClass,
}: {
  percent: number;
  label: string;
  valueText: string;
  barClass: string;
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      aria-valuetext={valueText}
      className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
    >
      <div
        className={`h-full rounded-full ${barClass} motion-safe:transition-[width]`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/**
 * RUNNING/COMPLETING — time used against the walltime, and how far WBM has
 * simulated (ADR 0027). The walltime bar is captioned as what it is, an upper
 * bound on the wait and not work done; the simulation bar is drawn only when
 * WBM's own log gives a fraction.
 */
export function RunningProgressCard() {
  const { live, view } = useLiveJobContext();
  const now = useNow(1_000);
  const hue = HUE.RUNNING;

  const limit = live?.time_limit_seconds ?? null;
  const start = view.slurm_start ?? view.started_at;
  // Before hydration there is no clock: print what does not depend on it.
  const elapsed = now === null ? null : elapsedSeconds(start, now);
  const used = elapsed === null ? null : walltimeUsed(elapsed, limit);
  const words = describeProgress(live?.progress ?? null);

  const elapsedText =
    elapsed === null
      ? null
      : limit
        ? `Elapsed ${formatDuration(elapsed)} of ${formatDuration(limit, { withSeconds: false })} walltime`
        : `Elapsed ${formatDuration(elapsed)}`;

  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader
        className={`border-b bg-gradient-to-r ${hue.gradient} to-transparent !py-4 !gap-0 grid-rows-1 items-center`}
      >
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${hue.tile}`}>
            <Activity className={`size-4 ${hue.icon}`} aria-hidden="true" />
          </div>
          Progress
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-5 pb-6">
        {/* Simulation progress */}
        <div className="space-y-2">
          {live?.progress ? (
            <>
              <p className="break-words text-sm font-medium text-foreground">{words.headline}</p>
              {words.percent !== null && (
                <Bar
                  percent={words.percent}
                  label="Simulation progress"
                  valueText={words.headline}
                  barClass="bg-primary"
                />
              )}
              {words.note && <p className="text-xs text-muted-foreground">{words.note}</p>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{words.note}</p>
          )}
        </div>

        {/* Walltime */}
        <div className="space-y-2">
          <p className="text-sm text-foreground">
            {elapsedText ?? (limit ? `${formatDuration(limit, { withSeconds: false })} walltime` : "Running.")}
          </p>
          {limit ? (
            <>
              <Bar
                percent={used?.percent ?? 0}
                label="Walltime used"
                valueText={elapsedText ?? "Not yet measured"}
                barClass={TONE_BAR[used?.tone ?? "normal"]}
              />
              <p className="text-xs text-muted-foreground">Walltime used</p>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
