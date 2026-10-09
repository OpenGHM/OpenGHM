import Link from "next/link";
import { TableHead, TableRow } from "@/components/ui/table";
import {
  StackedBody,
  StackedCell,
  StackedHeader,
  StackedRow,
  StackedTable,
} from "@/components/admin/stacked-table";
import { EmptyState } from "@/components/admin/admin-page";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { TimeStamp } from "@/components/common/time-stamp";
import { ClampedName } from "@/components/common/clamped-name";
import { displayStatus } from "@/lib/jobs/display-status";
import type { Job } from "@/lib/jobs/types";

// A job carries its owner's id, not an email, so the id is what is shown.
export function AdminJobsTable({ jobs }: { jobs: Job[] }) {
  if (jobs.length === 0) {
    return (
      <EmptyState title="No jobs match these filters.">
        Try another status, or clear the user filter.
      </EmptyState>
    );
  }

  return (
    <StackedTable>
      <StackedHeader>
        <TableRow>
          <TableHead>Sim ID</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead>Dataset</TableHead>
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
            <StackedCell label="Owner">
              <Link
                href={`/admin/users/${job.user_id}`}
                className="break-all text-xs text-slate-600 hover:underline"
              >
                {job.user_id}
              </Link>
            </StackedCell>
            <StackedCell label="Dataset" className="text-sm sm:max-w-48">
              <ClampedName lines={2}>{job.dataset_title}</ClampedName>
            </StackedCell>
            <StackedCell label="Status">
              <JobStatusBadge status={displayStatus(job)} />
            </StackedCell>
            <StackedCell label="Slurm ID" className="text-xs text-slate-500">
              {job.slurm_job_id ?? "—"}
            </StackedCell>
            <StackedCell label="Submitted" className="text-xs text-slate-500">
              <TimeStamp value={job.created_at} format="datetime" />
            </StackedCell>
          </StackedRow>
        ))}
      </StackedBody>
    </StackedTable>
  );
}
