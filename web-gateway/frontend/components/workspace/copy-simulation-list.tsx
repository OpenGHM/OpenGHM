"use client";

import { useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { TimeStamp } from "@/components/common/time-stamp";
import { KindBadge } from "@/components/repository/kind-badge";
import { fetchJobs } from "@/lib/jobs/actions";
import { displayName } from "@/lib/jobs/display-name";
import { displayStatus } from "@/lib/jobs/display-status";
import { simulationSource } from "@/lib/jobs/simulation-source";
import type { Job } from "@/lib/jobs/types";

/** One page of the caller's simulations, as the list needs it. */
export interface CopyListPage {
  items: Job[];
  page: number;
  totalPages: number;
}

/**
 * The caller's simulations, newest first, each with a Copy button that starts
 * a new draft from it, whatever its status. The first page comes from the
 * server; Previous and Next fetch the others and keep the page here, not in
 * the URL. A page that cannot be loaded says so in place and offers a retry,
 * and the rows on screen stay.
 *
 * Creating the draft is the caller's (`onCopy`, `pending`): one at a time for
 * the whole Start screen. `pendingId` is the row being copied, for its
 * spinner, and `rowError` is a message that belongs to one row (the snapshot it
 * was based on is gone).
 */
export function CopySimulationList({
  initial,
  onCopy,
  pendingId,
  disabled,
  rowError,
}: {
  /** The server's first page, or null when it could not be read. */
  initial: CopyListPage | null;
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
          className={`divide-y overflow-hidden rounded-xl border bg-card shadow-sm transition-opacity ${
            loading ? "opacity-60" : ""
          }`}
        >
          {data.items.map((job) => {
            const name = displayName(job);
            const source = simulationSource(job);
            const pending = pendingId === job.id;
            const error = rowError?.jobId === job.id ? rowError.message : null;
            return (
              <li key={job.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="min-w-0 break-words text-sm font-medium text-foreground">{name}</p>
                    <JobStatusBadge status={displayStatus(job)} />
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground">
                    <KindBadge kind={source.kind} />
                    <span className="min-w-0 truncate" title={source.title}>
                      {source.title}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Updated <TimeStamp value={job.updated_at ?? job.created_at} format="relative" />
                  </p>
                  {error && (
                    <p role="alert" className="mt-2 text-xs text-status-failed">
                      {error}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  aria-busy={pending ? "true" : undefined}
                  aria-label={`Copy ${name}`}
                  onClick={() => onCopy(job)}
                  className="min-h-10 shrink-0 sm:min-h-8"
                >
                  {pending ? (
                    <Loader2 aria-hidden="true" className="motion-safe:animate-spin" />
                  ) : (
                    <Copy aria-hidden="true" />
                  )}
                  Copy
                </Button>
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
