"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { SimulationRowActions } from "@/components/workspace/simulation-row-actions";
import { TimeStamp } from "@/components/common/time-stamp";
import { displayStatus } from "@/lib/jobs/display-status";
import type { Job } from "@/lib/jobs/types";

function displayName(job: Job): string {
  return job.about?.name || job.slug || job.sim_id || `Untitled (${job.id.slice(0, 8)})`;
}

/**
 * The simulations as a table from `sm` up, and as stacked rows below it (name
 * and status on one line, then the snapshot and the time), so a phone never
 * scrolls sideways. Both are rendered and CSS shows one; the row menu is the
 * same component in each.
 *
 * It is a client component because it owns the sign-in banner that a row's
 * Cancel or Delete shows when the session has ended.
 */
export function SimulationTable({ jobs }: { jobs: Job[] }) {
  const [sessionExpired, setSessionExpired] = useState(false);
  const expire = () => setSessionExpired(true);

  return (
    <div>
      {sessionExpired && (
        <div className="border-b p-3">
          <SessionExpiredBanner />
        </div>
      )}

      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Base snapshot</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-14">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => {
              const name = displayName(job);
              return (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/workspace/${job.id}`}
                      className="text-foreground hover:text-primary hover:underline"
                    >
                      {name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <JobStatusBadge status={displayStatus(job)} />
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-sm text-muted-foreground">
                    <Link
                      href={`/repository/${job.dataset_id}`}
                      className="hover:text-primary hover:underline"
                    >
                      {job.dataset_title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <TimeStamp value={job.updated_at ?? job.created_at} format="relative" />
                  </TableCell>
                  <TableCell className="py-1 text-right">
                    <SimulationRowActions job={job} name={name} onSessionExpired={expire} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ul aria-label="Simulations" className="divide-y sm:hidden">
        {jobs.map((job) => {
          const name = displayName(job);
          return (
            <li key={job.id} className="flex items-start gap-1 py-1.5 pr-2 pl-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2">
                  <Link
                    href={`/workspace/${job.id}`}
                    className="min-w-0 py-2.5 font-medium break-words text-foreground hover:text-primary hover:underline"
                  >
                    {name}
                  </Link>
                  <JobStatusBadge status={displayStatus(job)} />
                </div>
                <Link
                  href={`/repository/${job.dataset_id}`}
                  className="block truncate py-2.5 text-sm text-muted-foreground hover:text-primary hover:underline"
                >
                  {job.dataset_title}
                </Link>
                <p className="pb-2.5 text-xs text-muted-foreground">
                  Updated{" "}
                  <TimeStamp value={job.updated_at ?? job.created_at} format="relative" />
                </p>
              </div>
              <SimulationRowActions job={job} name={name} onSessionExpired={expire} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
