"use client";

import type { ReactNode } from "react";
import { useLiveJobContext } from "@/components/workspace/live-job-provider";
import { waitingSince } from "@/lib/workspace/job-runs";
import { secondsBetween, shortDuration } from "@/lib/workspace/timeline";
import {
  formatLocalDate,
  formatLocalTime,
  formatUtcDate,
  formatUtcTime,
  localZoneName,
} from "@/lib/workspace/time";
import { useNow } from "@/lib/workspace/use-now";

/** Whether the browser has taken over from the server's UTC render: times are
 *  UTC until then, so the server and the first client render agree. */
function useHydrated(): boolean {
  return useNow(60_000) !== null;
}

/** A time of day in the viewer's zone (UTC before hydration), in mono. */
function ClockTime({ iso, className }: { iso: string; className?: string }) {
  const hydrated = useHydrated();
  return (
    <time dateTime={iso} className={className}>
      {hydrated ? formatLocalTime(iso) : formatUtcTime(iso)}
    </time>
  );
}

/**
 * The day a run ended with the zone its times are in (`Oct 7, 2026 · GMT+9`),
 * in mono: what the status summary's heading says on its right, so the times
 * under the timeline need no date and no zone of their own.
 */
export function RunDay({ iso }: { iso: string }) {
  const hydrated = useHydrated();
  return (
    <time dateTime={iso} className="font-mono text-xs text-muted-foreground">
      {hydrated ? `${formatLocalDate(iso)} · ${localZoneName(iso)}` : `${formatUtcDate(iso)} · UTC`}
    </time>
  );
}

/** One end of the timeline: its time in mono over what happened. */
function Stop({ iso, align = "left", children }: { iso: string; align?: "left" | "right"; children: ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${align === "right" ? "text-right" : ""}`}>
      <ClockTime iso={iso} className="font-mono text-foreground" />
      <span>{children}</span>
    </div>
  );
}

/**
 * A finished run on one line: a bar of the time it waited in the queue (striped)
 * and the time it ran, in proportion, with when it was submitted, started and
 * ended under it. Read from the same moments the Run details card and the
 * heading's "Completed in 10 min" use (SLURM's own when the poll has them, else
 * the gateway's), so it adds no number of its own. Nothing is drawn unless the
 * start and the end are known; a run with no submit time is only the run. Of a
 * simulation continued in several jobs it is the last job's: its wait counts
 * from the end of the job before it, and the earlier jobs are listed beside
 * (`JobHistory`).
 */
export function RunTimeline() {
  const { submittedAt, startedAt, completedAt, view } = useLiveJobContext();
  const started = view.slurm_start ?? startedAt;
  const ended = view.slurm_end ?? completedAt;
  const ran = secondsBetween(started, ended);
  if (!started || !ended || ran === null) return null;
  // Of a continued simulation, the last job's own wait: from the end of the
  // job before it.
  const continued = view.previous_jobs.length > 0;
  const submitted = waitingSince(view.previous_jobs, submittedAt);
  const queued = submitted ? secondsBetween(submitted, started) : null;

  return (
    <div className="mt-6 space-y-2">
      <div aria-hidden="true" className="flex h-3 gap-[3px] overflow-hidden rounded-xl">
        {queued !== null && (
          <div
            data-testid="timeline-queued"
            className="min-w-1.5 rounded-[3px] bg-[repeating-linear-gradient(135deg,var(--queued)_0_4px,color-mix(in_srgb,var(--queued)_50%,var(--card))_4px_8px)]"
            style={{ flexGrow: Math.max(queued, 1), flexBasis: 0 }}
          />
        )}
        <div
          data-testid="timeline-ran"
          className="min-w-1.5 rounded-[3px] bg-status-completed"
          style={{ flexGrow: Math.max(ran, 1), flexBasis: 0 }}
        />
      </div>
      <div
        className="grid text-[12.5px] text-muted-foreground"
        style={{
          gridTemplateColumns: queued !== null ? `${Math.max(queued, 1)}fr ${Math.max(ran, 1)}fr` : "1fr",
        }}
      >
        {queued !== null && submitted && (
          <Stop iso={submitted}>
            {continued ? "Resubmitted" : "Submitted"} · queued {shortDuration(queued)}
          </Stop>
        )}
        <div className="flex justify-between gap-3">
          <Stop iso={started}>Started · ran {shortDuration(ran)}</Stop>
          <Stop iso={ended} align="right">
            Ended
          </Stop>
        </div>
      </div>
    </div>
  );
}
