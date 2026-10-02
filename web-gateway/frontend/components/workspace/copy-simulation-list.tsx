"use client";

import { useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JobStatusDot } from "@/components/jobs/job-status-badge";
import { TimeStamp } from "@/components/common/time-stamp";
import { fetchJobs } from "@/lib/jobs/actions";
import { displayName } from "@/lib/jobs/display-name";
import { displayStatus } from "@/lib/jobs/display-status";
import { simulationSource } from "@/lib/jobs/simulation-source";
import type { Job } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";

/** One page of the caller's simulations, as the list needs it. */
export interface CopyListPage {
  items: Job[];
  page: number;
  totalPages: number;
}

/**
 * The caller's simulations, newest first, as one plain list: the name, the
 * status (a dot and its word), the short name of the snapshot it is based on
 * and when it changed. A row is a button: a click starts a new draft from it,
 * whatever its status; "Copy" at its end says so. The first page comes from the
 * server; Previous and Next fetch the others and keep the page here, not in
 * the URL. A page that cannot be loaded says so in place and offers a retry,
 * and the rows on screen stay.
 *
 * Creating the draft is the caller's (`onCopy`, `pending`): one at a time for
 * the whole Start screen. `pendingId` is the row being copied, for its
 * spinner, and `rowError` is a message that belongs to one row (the snapshot it
 * was based on is gone). `snapshotNames` maps a snapshot id to its short name
 * (`snapshotName`); a snapshot it does not know is shown by the title the
 * simulation was made with.
 */
export function CopySimulationList({
  initial,
  snapshotNames,
  onCopy,
  pendingId,
  disabled,
  rowError,
}: {
  /** The server's first page, or null when it could not be read. */
  initial: CopyListPage | null;
  /** Snapshot id to short name, for the snapshots the page could read. */
  snapshotNames: Readonly<Record<string, string>>;
  onCopy: (job: Job) => void;
  pendingId: string | null;
  /** Every Copy is off while a draft is being created. */
  disabled: boolean;
  rowError: { jobId: string; message: string } | null;
}) {
  const [data, setData] = useState<CopyListPage | null>(initial);
  const [loading, setLoading] = useState(false);
  // The page that failed to load, so Retry asks for the same one.
  const [failedPage, setFailedPage] = useState<number | null>(initial ? null : 1);

  const goTo = async (page: number) => {
    setLoading(true);
    setFailedPage(null);
    try {
      const res = await fetchJobs(page);
      setData({ items: res.items, page: res.page, totalPages: res.total_pages });
    } catch {
      setFailedPage(page);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {failedPage !== null && (
        <div
          role="alert"
          className="mb-4 flex flex-col gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="flex items-start gap-2 font-medium">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Couldn&apos;t load your simulations. Nothing was changed.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => void goTo(failedPage)}
            className="min-h-10 shrink-0 border-destructive/30 bg-white text-destructive hover:bg-destructive/10 sm:min-h-8"
          >
            Retry
          </Button>
        </div>
      )}

      {data && data.items.length === 0 && (
        <p className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          You have no simulations to copy yet
        </p>
      )}

      {data && data.items.length > 0 && (
        <ul
          aria-label="Your simulations"
          aria-busy={loading ? "true" : undefined}
          className={cn(
            "divide-y overflow-hidden rounded-xl border bg-card shadow-sm transition-opacity",
            loading && "opacity-60"
          )}
        >
          {data.items.map((job) => {
            const name = displayName(job);
            const status = displayStatus(job);
            const source = simulationSource(job);
            const basedOn = snapshotNames[source.id] ?? source.title;
            const pending = pendingId === job.id;
            const error = rowError?.jobId === job.id ? rowError.message : null;
            return (
              <li key={job.id}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-busy={pending ? "true" : undefined}
                  aria-label={`Copy ${name}`}
                  onClick={() => onCopy(job)}
                  className={cn(
                    "group flex min-h-16 w-full items-center gap-4 px-5 py-3.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50",
                    disabled && !pending && "cursor-not-allowed opacity-60 hover:bg-transparent"
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-foreground">{name}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted-foreground">
                      <JobStatusDot status={status} />
                      <span aria-hidden="true">·</span>
                      <span className="min-w-0 truncate" title={source.title}>
                        {basedOn}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Updated <TimeStamp value={job.updated_at ?? job.created_at} format="relative" />
                      </span>
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors group-hover:text-primary group-focus-visible:text-primary">
                    {pending ? (
                      <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
                    ) : (
                      <Copy aria-hidden="true" className="size-4" />
                    )}
                    Copy
                  </span>
                </button>
                {error && (
                  <p role="alert" className="-mt-1 px-5 pb-3 text-xs text-status-failed">
                    {error}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {data && data.totalPages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-center gap-4 pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading || data.page <= 1}
            onClick={() => void goTo(data.page - 1)}
            className="min-h-10 sm:min-h-8"
          >
            <ChevronLeft aria-hidden="true" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {data.page} of {data.totalPages}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading || data.page >= data.totalPages}
            onClick={() => void goTo(data.page + 1)}
            className="min-h-10 sm:min-h-8"
          >
            Next
            <ChevronRight aria-hidden="true" />
          </Button>
        </nav>
      )}
    </div>
  );
}
