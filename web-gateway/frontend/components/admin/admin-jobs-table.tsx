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
import type { Job } from "@/lib/jobs/types";

// JobResponse doesn't carry the owner's email (only user_id) — see the
// admin console plan's note on this gap. Showing the raw id is honest
// about what the API gives us rather than faking a lookup here.
export function AdminJobsTable({ jobs }: { jobs: Job[] }) {
  if (jobs.length === 0) {
    return <p className="text-sm text-slate-500 py-6 text-center">No jobs match these filters.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Sim ID</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead>Dataset</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Slurm ID</TableHead>
          <TableHead>Submitted</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell>
              <Link href={`/simulations/${job.id}`} className="font-mono text-xs text-primary hover:underline">
                {job.sim_id || job.id.slice(0, 12)}
              </Link>
            </TableCell>
            <TableCell>
              <Link href={`/admin/users/${job.user_id}`} className="text-xs text-slate-600 hover:underline">
                {job.user_id}
              </Link>
            </TableCell>
            <TableCell className="max-w-48 truncate text-sm">{job.dataset_title}</TableCell>
            <TableCell>
              <JobStatusBadge status={job.status} />
            </TableCell>
            <TableCell className="text-xs text-slate-500">{job.slurm_job_id ?? "—"}</TableCell>
            <TableCell className="text-xs text-slate-500">
              {new Date(job.created_at).toLocaleString()}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
