/**
 * Dev-only escape hatch for looking at every `JobStatus` a simulation can be
 * in. Real jobs in the dev database only ever reach `DRAFT` or `FAILED` —
 * nothing runs real WBM, so `RUNNING`/`COMPLETED`/etc. can't occur yet
 * (AGENTS.md rule 1: nothing here is rebuilt or half-real, so we don't
 * pretend a route produces them). `?preview=<STATUS>` on
 * `/workspace/[id]` renders the page from `fakeSimulation(status)` instead
 * of a real fetch, so the lifecycle UI can be reviewed end to end.
 *
 * Refused outside development so it is never a production code path.
 */
import type { JobStatus } from "@/lib/jobs/types";

const ALL_STATUSES: readonly JobStatus[] = [
  "DRAFT",
  "PENDING",
  "SUBMITTED",
  "RUNNING",
  "COMPLETING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
];

export function resolvePreviewStatus(raw: string | undefined): JobStatus | null {
  if (!raw) return null;
  if (process.env.NODE_ENV === "production") return null;
  return (ALL_STATUSES as readonly string[]).includes(raw) ? (raw as JobStatus) : null;
}

export { ALL_STATUSES };
