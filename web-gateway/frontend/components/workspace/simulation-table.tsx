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
import { displayStatus } from "@/lib/jobs/display-status";
import type { Job } from "@/lib/jobs/types";

function displayName(job: Job): string {
  return job.about?.name || job.slug || job.sim_id || `Untitled (${job.id.slice(0, 8)})`;
}

export function SimulationTable({ jobs }: { jobs: Job[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Base snapshot</TableHead>
          <TableHead>Updated</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell className="font-medium">
              <Link
                href={`/workspace/${job.id}`}
                className="text-foreground hover:text-primary hover:underline"
              >
                {displayName(job)}
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
              {new Date(job.updated_at ?? job.created_at).toLocaleString()}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
