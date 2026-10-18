"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check,
  Globe,
  Hourglass,
  Loader2,
  Minus,
  Pencil,
  RotateCw,
  Search,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { JobStatusPill } from "@/components/jobs/job-status-badge";
import { TimeStamp } from "@/components/common/time-stamp";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { COLUMNS } from "@/components/workspace/draft-columns";
import { DraftDeleteButton } from "@/components/workspace/draft-delete-button";
import { GlyphTile, HEADER_ROW, ListEmptyCard, ROW_CARD } from "@/components/workspace/list-card";
import { matchesQuery } from "@/components/workspace/search-field";
import { useDraftSearch } from "@/components/workspace/draft-search";
import { displayStatus, type DisplayStatus } from "@/lib/jobs/display-status";
import { displayName, listName } from "@/lib/jobs/display-name";
import { ClampedName, clampClass } from "@/components/common/clamped-name";
import { draftSource } from "@/lib/jobs/draft-source";
import { runPeriodLabel } from "@/lib/jobs/run-period-label";
import { splitVersion } from "@/lib/jobs/title-version";
import { HUE } from "@/lib/jobs/status-hue";
import { kindLabel } from "@/lib/repository/catalogue-format";
import { cn } from "@/lib/utils";
import type { Job } from "@/lib/jobs/types";

/** The glyph on a row's tile, by the status it shows: ✓ done, ! failed, ✎ being
 *  edited, ↻ in progress, – stopped. */
const GLYPH: Record<DisplayStatus, LucideIcon> = {
  DRAFT: Pencil,
  PENDING: Hourglass,
  SUBMITTED: Hourglass,
  RUNNING: RotateCw,
  COMPLETING: RotateCw,
  CANCELLING: Minus,
  COMPLETED: Check,
  FAILED: TriangleAlert,
  CANCELLED: Minus,
};

/**
 * The status column of a row, as a pill. A draft that was published reads
 * *Published* and links to its snapshot, raised above the row's own stretched
 * link; one being published reads *Publishing*; every other draft reads its
 * status.
 */
function PublishedOrStatus({ job }: { job: Job }) {
  const publish = job.publish;
  if (publish?.state === "published") {
    return (
      <Link
        href={`/repository/${publish.snapshot_id}`}
        title="Open the published snapshot"
        className={cn(
          "relative z-10 inline-flex min-h-6 items-center gap-[7px] rounded-full py-[5px] pr-[11px] pl-[9px] text-[12.5px] font-semibold outline-none transition-colors hover:bg-status-completed/20 focus-visible:ring-[3px] focus-visible:ring-ring/50",
          HUE.COMPLETED.tile,
          HUE.COMPLETED.icon,
        )}
      >
        <Globe className="size-3.5 shrink-0" aria-hidden="true" />
        Published
      </Link>
    );
  }
  if (publish?.state === "publishing") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-[7px] rounded-full py-[5px] pr-[11px] pl-[9px] text-[12.5px] font-semibold",
          HUE.RUNNING.tile,
          HUE.RUNNING.icon,
        )}
      >
        <Loader2 className="size-3.5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
        Publishing
      </span>
    );
  }
  return <JobStatusPill status={displayStatus(job)} />;
}

/**
 * The snapshot drafts as a stack of row cards, each a link to the snapshot
 * draft: a tile with the status's glyph; the name (a draft nobody named reads
 * as its snapshot's short title and run period) with, under it, a chip with
 * the snapshot's version and the title of the snapshot it is based on (one
 * line, cut with an ellipsis, the whole title on hover), or, for a draft
 * nobody named, its run id, mono and muted, since its name already says the
 * snapshot; the period it ran (`runPeriodLabel`, the one format
 * the simulation page uses too); its status, when
 * it was last updated, and a visible Delete once it can be deleted. From `lg`
 * up the rows sit in columns under a mono header; below it each row is two
 * lines (name, then period, status and time, Delete beside them), so nothing
 * scrolls sideways.
 *
 * The row is one link by way of its name's stretched `::after`, with Delete
 * above it. It filters on what the list's search box says
 * (`DraftSearchProvider`), over the rows it is given. A client component,
 * because it owns the sign-in banner that a row's Delete shows when the session
 * has ended, and reads the search box.
 */
export function DraftTable({
  jobs,
  moreThanOnePage = false,
}: {
  jobs: Job[];
  /** The list continues on other pages; a search says it only looked at this one. */
  moreThanOnePage?: boolean;
}) {
  const [sessionExpired, setSessionExpired] = useState(false);
  const expire = () => setSessionExpired(true);
  const { query, setQuery } = useDraftSearch();

  const rows = jobs.filter((job) => matchesQuery(`${displayName(job)} ${job.sim_id ?? ""}`, query));

  return (
    <div className="flex flex-col gap-3.5">
      {sessionExpired && <SessionExpiredBanner />}

      {rows.length === 0 ? (
        <ListEmptyCard
          icon={<Search />}
          title={<>No snapshot draft matches &ldquo;{query.trim()}&rdquo;</>}
          hint={
            moreThanOnePage ? "Only the snapshot drafts on this page were searched." : "Check the spelling, or clear the search."
          }
        >
          <button
            type="button"
            onClick={() => setQuery("")}
            className="inline-flex min-h-10 items-center rounded-[11px] bg-hero px-4 text-[13.5px] font-semibold text-white outline-none transition-colors hover:bg-hero/90 focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Clear search
          </button>
        </ListEmptyCard>
      ) : (
        <>
          <div aria-hidden="true" className={cn(HEADER_ROW, COLUMNS)}>
            <span className="lg:pl-[62px]">Name</span>
            <span>Run period</span>
            <span>Status</span>
            <span>Updated</span>
            <span />
          </div>
          <ul aria-label="Snapshot drafts" className="flex flex-col gap-2">
            {rows.map((job) => {
              const name = displayName(job);
              const shown = listName(job);
              const source = draftSource(job);
              const { version, rest } = splitVersion(source.title);
              const period = runPeriodLabel(job.parameters?.temporal_range_start, job.parameters?.temporal_range_end);
              const status = displayStatus(job);
              // A published draft is done, and its tile says so.
              const Glyph = job.publish?.state === "published" ? Check : GLYPH[status];
              return (
                <li
                  key={job.id}
                  className={cn(
                    ROW_CARD,
                    "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 px-4 py-3.5 sm:px-5 sm:py-4 lg:gap-x-4",
                    COLUMNS,
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                    <GlyphTile tone={cn(HUE[status].tile, HUE[status].icon)}>
                      <Glyph className="size-5" strokeWidth={2.5} />
                    </GlyphTile>
                    <div className="min-w-0">
                      <p className="flex min-w-0 items-baseline gap-2">
                        <Link
                          href={`/workspace/${job.id}`}
                          title={shown.text}
                          className={cn(
                            clampClass(1),
                            "text-base font-[550] tracking-[-0.01em] text-foreground outline-none after:absolute after:inset-0 after:content-['']",
                            /^sim-/.test(shown.text) && "font-mono text-[15px] font-medium tracking-normal",
                          )}
                        >
                          {shown.text}
                        </Link>
                      </p>
                      <p className="mt-1.5 flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
                        {version && (
                          <span className="shrink-0 rounded-md bg-secondary px-[7px] py-0.5 font-mono text-[11.5px] text-secondary-foreground">
                            {version}
                          </span>
                        )}
                        {/* A name made from the snapshot's title already says which snapshot
                            it came from, so the row says which run it is instead. */}
                        {source.kind !== "snapshot" && <span className="shrink-0">{kindLabel(source.kind)} ·</span>}
                        {shown.id ? (
                          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{shown.id}</span>
                        ) : (
                          <ClampedName lines={1} title={source.title}>
                            {rest}
                          </ClampedName>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-[52px] sm:pl-[62px] lg:contents">
                    <span className="order-3 font-mono text-[13px] leading-snug text-foreground/85 lg:order-none">
                      {period ? (
                        <>
                          <span className="sr-only">Run period </span>
                          {period}
                        </>
                      ) : (
                        <span aria-hidden="true">&mdash;</span>
                      )}
                    </span>
                    <span className="order-1 lg:order-none">
                      <span className="sr-only">Status: </span>
                      <PublishedOrStatus job={job} />
                    </span>
                    <span className="order-2 text-[13px] whitespace-nowrap text-muted-foreground lg:order-none">
                      <span className="sr-only">Updated </span>
                      <TimeStamp value={job.updated_at ?? job.created_at} format="relative" />
                    </span>
                  </div>

                  <div className="col-start-2 row-start-1 justify-self-end lg:col-auto lg:row-auto">
                    <DraftDeleteButton job={job} name={name} onSessionExpired={expire} />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
