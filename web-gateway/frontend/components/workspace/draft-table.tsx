"use client";

import { useState } from "react";
import Link from "next/link";
import { JobStatusDot } from "@/components/jobs/job-status-badge";
import { TimeStamp } from "@/components/common/time-stamp";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { COLUMNS } from "@/components/workspace/draft-columns";
import { DraftDeleteButton } from "@/components/workspace/draft-delete-button";
import { matchesQuery } from "@/components/workspace/search-field";
import { useDraftSearch } from "@/components/workspace/draft-search";
import { displayStatus } from "@/lib/jobs/display-status";
import { displayName, listName } from "@/lib/jobs/display-name";
import { draftSource } from "@/lib/jobs/draft-source";
import { kindLabel } from "@/lib/repository/catalogue-format";
import type { Job } from "@/lib/jobs/types";

/**
 * The snapshot drafts as one card of rows, each row a link to the snapshot draft: its
 * name with, under it, the title of the snapshot it is based on (one line,
 * cut with an ellipsis, the whole title on hover) and, when the simulation is shorter
 * than the snapshot's coverage, the period it ran; its status, when it was last
 * updated, and a visible Delete once it can be deleted. From `sm` up
 * the rows sit in columns under a small header; on a phone each row stacks (name
 * and meta, then status and time, Delete beside them), so nothing scrolls
 * sideways.
 *
 * The row is one link by way of its name's stretched `::after`, with Delete
 * above it. It filters on what the list's search box says
 * (`DraftSearchProvider`), over the rows it is given. A client component,
 * because it owns the sign-in banner that a row's Delete shows when the session
 * has ended, and reads the search box.
 */
export function DraftTable({
  jobs,
  runNotes = {},
  moreThanOnePage = false,
}: {
  jobs: Job[];
  /** "Run 2000–2005", by job id, for the jobs that ran less than their snapshot
   *  covers (`runNotes`, built on the server from the snapshots' coverage). */
  runNotes?: Record<string, string>;
  /** The list continues on other pages; a search says it only looked at this one. */
  moreThanOnePage?: boolean;
}) {
  const [sessionExpired, setSessionExpired] = useState(false);
  const expire = () => setSessionExpired(true);
  const { query, setQuery } = useDraftSearch();

  const rows = jobs.filter((job) => matchesQuery(displayName(job), query));

  return (
    <div className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
      {sessionExpired && (
        <div className="border-b p-3">
          <SessionExpiredBanner />
        </div>
      )}

      <div
        aria-hidden="true"
        className={`hidden gap-x-4 border-b bg-muted/40 px-5 py-2.5 font-mono text-[11px] tracking-wider text-muted-foreground uppercase sm:grid ${COLUMNS}`}
      >
        <span>Name</span>
        <span>Status</span>
        <span>Updated</span>
        <span />
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm font-medium text-foreground">No snapshot draft matches &ldquo;{query.trim()}&rdquo;</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {moreThanOnePage ? "Only the snapshot drafts on this page were searched." : "Check the spelling, or clear the search."}
          </p>
          <button
            type="button"
            onClick={() => setQuery("")}
            className="mt-3 inline-flex min-h-10 items-center rounded-md px-2 text-sm font-medium text-primary underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Clear search
          </button>
        </div>
      ) : (
        <ul aria-label="Snapshot drafts" className="divide-y">
          {rows.map((job) => {
            const name = displayName(job);
            const shown = listName(job);
            const source = draftSource(job);
            const runNote = runNotes[job.id];
            return (
              <li
                key={job.id}
                className={`relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-muted/50 has-[a:focus-visible]:bg-muted/50 has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-inset has-[a:focus-visible]:ring-ring/50 motion-reduce:transition-none sm:gap-x-4 sm:px-5 sm:py-3.5 ${COLUMNS}`}
              >
                <div className="min-w-0">
                  <p className="flex min-w-0 items-baseline gap-2">
                    <Link
                      href={`/workspace/${job.id}`}
                      className="min-w-0 truncate text-[15px] font-medium text-foreground outline-none after:absolute after:inset-0 after:content-['']"
                    >
                      {shown.text}
                    </Link>
                    {shown.id && <span className="shrink-0 font-mono text-xs text-muted-foreground">{shown.id}</span>}
                  </p>
                  <p className="mt-0.5 flex min-w-0 items-baseline gap-x-2 text-[13px] text-muted-foreground">
                    {source.kind !== "snapshot" && <span className="shrink-0">{kindLabel(source.kind)} ·</span>}
                    <span title={source.title} className="min-w-0 truncate">
                      {source.title}
                    </span>
                    {runNote && <span className="shrink-0 whitespace-nowrap">· {runNote}</span>}
                  </p>
                </div>

                <div className="col-start-1 flex items-center gap-2 sm:contents">
                  <span>
                    <span className="sr-only">Status: </span>
                    <JobStatusDot status={displayStatus(job)} />
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground sm:hidden">
                    ·
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    <span className="sr-only">Updated </span>
                    <TimeStamp value={job.updated_at ?? job.created_at} format="relative" />
                  </span>
                </div>

                <div className="col-start-2 row-span-2 row-start-1 justify-self-end sm:col-auto sm:row-auto sm:row-span-1">
                  <DraftDeleteButton job={job} name={name} onSessionExpired={expire} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
