import Link from "next/link";
import { TableHead, TableRow } from "@/components/ui/table";
import {
  StackedBody,
  StackedCell,
  StackedHeader,
  StackedRow,
  StackedTable,
} from "@/components/admin/stacked-table";
import { EmptyState } from "@/components/admin/admin-states";
import { Person } from "@/components/admin/person";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { TimeStamp } from "@/components/common/time-stamp";
import { ClampedName } from "@/components/common/clamped-name";
import { displayStatus } from "@/lib/jobs/display-status";
import type { UserLabels } from "@/lib/admin/types";
import type { Job } from "@/lib/jobs/types";

/**
 * A job carries its owner's id, not a name: `owners` (`fetchUserLabels`) says
 * who that is, and an owner it does not know shows the id.
 */
export function AdminJobsTable({ jobs, owners = {} }: { jobs: Job[]; owners?: UserLabels }) {
  if (jobs.length === 0) {
    return (
      <EmptyState title="No simulations match these filters.">
        Try another status, or clear the user filter.
      </EmptyState>
    );
  }

  return (
    <StackedTable>
      <StackedHeader>
        <TableRow>
          <TableHead>Run ID</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead>Snapshot</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Slurm ID</TableHead>
          <TableHead>Submitted</TableHead>
        </TableRow>
      </StackedHeader>
      <StackedBody>
        {jobs.map((job) => (
          <StackedRow key={job.id}>
            <StackedCell>
              <Link
                href={`/workspace/${job.id}`}
                className="inline-flex min-h-10 items-center font-mono text-xs text-primary hover:underline sm:min-h-0"
              >
                {job.sim_id || job.id.slice(0, 12)}
              </Link>
            </StackedCell>
            <StackedCell label="Owner" className="text-sm">
              <Person id={job.user_id} labels={owners} />
            </StackedCell>
            <StackedCell label="Snapshot" className="text-sm sm:max-w-48">
              <ClampedName lines={2}>{job.dataset_title}</ClampedName>
            </StackedCell>
            <StackedCell label="Status">
              <JobStatusBadge status={displayStatus(job)} />
            </StackedCell>
            <StackedCell label="Slurm ID" className="text-xs text-muted-foreground">
              {job.slurm_job_id ?? "—"}
            </StackedCell>
            <StackedCell label="Submitted" className="text-xs text-muted-foreground">
              {job.submitted_at ? (
                <TimeStamp value={job.submitted_at} format="datetime" />
              ) : (
                // A draft that was never submitted has no submission time:
                // say so, and keep the one time the record does have.
                <span>
                  Not submitted
                  <span className="block">
                    created <TimeStamp value={job.created_at} format="datetime" />
                  </span>
                </span>
              )}
            </StackedCell>
          </StackedRow>
        ))}
      </StackedBody>
    </StackedTable>
  );
}
