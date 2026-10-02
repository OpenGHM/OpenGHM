"use client";

import { useLiveJobContext } from "@/components/workspace/live-job-provider";
import {
  formatLocalDate,
  formatLocalDateTime,
  formatLocalTime,
  formatUtcDate,
  formatUtcDateTime,
  formatUtcTime,
} from "@/lib/workspace/time";
import { secondsBetween, shortDuration } from "@/lib/workspace/timeline";
import { useNow } from "@/lib/workspace/use-now";

/** One moment as a short clock time, with its full date and zone on hover. */
function Moment({ iso, sameDayAs, hydrated }: { iso: string; sameDayAs: string; hydrated: boolean }) {
  return (
    <time dateTime={iso} title={hydrated ? formatLocalDateTime(iso) : formatUtcDateTime(iso)}>
      {hydrated ? formatLocalTime(iso, sameDayAs) : formatUtcTime(iso, sameDayAs)}
    </time>
  );
}

/**
 * Where the job has been, on one line: `Oct 3, 2026 · Submitted 3:33 AM ·
 * Waited 3 min · Ran 14 min · Ended 3:50 AM`. The date is printed once, for the
 * moment of submission; a later moment on another day carries its own. The full
 * date and zone are on hover. Times are the viewer's own after hydration (UTC
 * before it, so the server and the browser agree).
 */
export function JobTimeline({ className }: { className?: string }) {
  const { view, status, submittedAt, startedAt, completedAt } = useLiveJobContext();
  const now = useNow(30_000);
  const hydrated = now !== null;
  if (!submittedAt) return null;

  const started = view.slurm_start ?? startedAt;
  const ended = view.slurm_end ?? completedAt;
  const ending = ["COMPLETED", "FAILED", "CANCELLED"].includes(status);
  const waited = secondsBetween(submittedAt, started);
  const ran = ending ? secondsBetween(started, ended) : null;
  // Still queued: how long so far, from the clock.
  const waitingFor = started === null && !ending && now !== null ? secondsBetween(submittedAt, new Date(now).toISOString()) : null;

  const parts: React.ReactNode[] = [
    <span key="date" title={hydrated ? formatLocalDateTime(submittedAt) : formatUtcDateTime(submittedAt)}>
      {hydrated ? formatLocalDate(submittedAt) : formatUtcDate(submittedAt)}
    </span>,
    <span key="submitted">
      Submitted <Moment iso={submittedAt} sameDayAs={submittedAt} hydrated={hydrated} />
    </span>,
  ];
  if (waited !== null) parts.push(<span key="waited">Waited {shortDuration(waited)}</span>);
  if (waitingFor !== null) parts.push(<span key="waiting">Waiting {shortDuration(waitingFor)}</span>);
  if (started && !ending) {
    parts.push(
      <span key="started">
        Started <Moment iso={started} sameDayAs={submittedAt} hydrated={hydrated} />
      </span>
    );
  }
  if (ran !== null) parts.push(<span key="ran">Ran {shortDuration(ran)}</span>);
  if (view.cancel_requested_at && ending) {
    parts.push(
      <span key="cancel">
        Cancel requested <Moment iso={view.cancel_requested_at} sameDayAs={submittedAt} hydrated={hydrated} />
      </span>
    );
  }
  if (ending && ended) {
    parts.push(
      <span key="ended">
        Ended <Moment iso={ended} sameDayAs={submittedAt} hydrated={hydrated} />
      </span>
    );
  }

  return (
    <p className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground ${className ?? ""}`}>
      {parts.map((part, i) => (
        <span key={i} className="inline-flex items-center gap-x-2">
          {i > 0 && <span aria-hidden="true">·</span>}
          {part}
        </span>
      ))}
    </p>
  );
}
