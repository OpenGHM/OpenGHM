"use client";

import { TimeStamp } from "@/components/common/time-stamp";
import { useLiveJobContext } from "@/components/workspace/live-job-provider";
import { jobRanSeconds } from "@/lib/workspace/job-runs";
import { shortDuration } from "@/lib/workspace/timeline";

/**
 * The jobs of a simulation that already ended, oldest first (ADR 0037): the
 * number, SLURM's id and state, when it ran and for how long, and when WBM last
 * saved its state in it, which is where the next job carried on from. Nothing
 * is drawn for a simulation run by one job. The job running now (or that ran
 * last) is the rest of the status card.
 */
export function JobHistory() {
  const { view } = useLiveJobContext();
  const jobs = view.previous_jobs;
  if (jobs.length === 0) return null;

  return (
    <div className="mt-6 space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground">Earlier jobs</h3>
      <ol className="space-y-1.5 text-[12.5px]">
        {jobs.map((job) => {
          const ran = jobRanSeconds(job);
          return (
            <li
              key={job.number}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md bg-muted/40 px-3 py-2"
            >
              <span className="font-medium text-foreground">Job {job.number}</span>
              {job.slurm_job_id && <span className="font-mono text-muted-foreground">#{job.slurm_job_id}</span>}
              {job.slurm_state && <span className="font-mono text-muted-foreground">{job.slurm_state}</span>}
              {job.slurm_start && (
                <span className="text-muted-foreground">
                  <TimeStamp value={job.slurm_start} className="font-mono" />
                  {job.slurm_end && (
                    <>
                      {" – "}
                      <TimeStamp value={job.slurm_end} className="font-mono" />
                    </>
                  )}
                  {ran !== null && <> · ran {shortDuration(ran)}</>}
                </span>
              )}
              {job.state_saved_at && (
                <span className="text-muted-foreground">
                  State saved <TimeStamp value={job.state_saved_at} className="font-mono" />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
