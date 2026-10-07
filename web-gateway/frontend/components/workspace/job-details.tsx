"use client";

import { useId, useState } from "react";
import { describeOutput } from "@/components/workspace/output-choice-field";
import { useLiveJobContext } from "@/components/workspace/live-job-provider";
import { TimeStamp } from "@/components/common/time-stamp";
import { describeHours, effectiveCompute, parseSlurmTime, type Recommended } from "@/lib/jobs/compute";
import type { Job } from "@/lib/jobs/types";

/** Variables drawn before "Show all". */
const VARIABLES_SHOWN = 6;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 min-w-0 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

const MONO = "font-mono text-xs break-all";

/** The output variables: how many, the first few, and the rest on request. */
function Variables({ variables }: { variables: string[] }) {
  const [all, setAll] = useState(false);
  const regionId = useId();
  const shown = all ? variables : variables.slice(0, VARIABLES_SHOWN);
  return (
    <div id={regionId} className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-sm font-medium">{variables.length}</span>
      {shown.map((v) => (
        <span key={v} className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
          {v}
        </span>
      ))}
      {variables.length > VARIABLES_SHOWN && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          aria-controls={regionId}
          className="min-h-10 rounded-md px-2 text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8"
        >
          {all ? "Show fewer" : `Show all ${variables.length}`}
        </button>
      )}
    </div>
  );
}

/**
 * What the simulation was asked to do and where it ran, read-only once past DRAFT.
 * Cores and walltime are what the job asked SLURM for: the draft's own choice,
 * else the model snapshot's recommendation worked out the way the submit does
 * (`effectiveCompute`, the backend's `resolve_compute`), marked as such. While
 * SLURM has the job, the limit it enforces is shown instead. A value that
 * cannot be known (no recommendation to read) is a dash, not a guess.
 */
export function JobDetails({ job, recommended }: { job: Job; recommended: Recommended | null }) {
  const { view, live, submittedAt, startedAt, completedAt } = useLiveJobContext();
  const { parameters, slurm_config: config } = job;
  const compute = effectiveCompute(config, recommended);

  const limit = live?.time_limit_seconds ?? null;
  const walltimeSeconds = compute.walltime ? parseSlurmTime(compute.walltime) : null;
  const walltime =
    limit !== null
      ? describeHours(limit)
      : walltimeSeconds !== null
        ? describeHours(walltimeSeconds)
        : null;
  const walltimeNote =
    limit === null && walltime !== null && compute.walltimeSource === "snapshot"
      ? compute.walltimeCapped
        ? "(the limit for one job)"
        : "(recommended + 50%)"
      : null;
  const coresNote = compute.cores !== null && compute.coresSource === "snapshot" ? "(recommended)" : null;
  const domain = parameters.spatial_domain;
  const workDir = view.work_dir ?? job.work_dir;
  const ended = view.completed_at ?? completedAt;

  return (
    <section aria-labelledby="job-details-heading">
      <h2 id="job-details-heading" className="mb-3 text-lg font-semibold text-foreground">
        Details
      </h2>
      <div className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          <Row label="Run period">
            {parameters.temporal_range_start} &rarr; {parameters.temporal_range_end}
          </Row>
          {domain && (
            <Row label="Spatial domain">
              <span className="font-mono text-xs">
                N{domain.north}&deg; S{domain.south}&deg; E{domain.east}&deg; W{domain.west}&deg;
              </span>
            </Row>
          )}
          <Row label="Cores">
            {compute.cores ?? <span className="text-muted-foreground">—</span>}
            {coresNote && <span className="ml-1.5 text-xs text-muted-foreground">{coresNote}</span>}
          </Row>
          <Row label="Walltime">
            {walltime ?? <span className="text-muted-foreground">—</span>}
            {walltimeNote && <span className="ml-1.5 text-xs text-muted-foreground">{walltimeNote}</span>}
          </Row>
          {job.toolkit?.commit && (
            <Row label="Toolkit commit">
              <span className={MONO}>{job.toolkit.commit}</span>
            </Row>
          )}
          {workDir && (
            <Row label="Work directory">
              <span className={MONO}>{workDir}</span>
            </Row>
          )}
          {submittedAt && (
            <Row label="Submitted">
              <TimeStamp value={submittedAt} />
            </Row>
          )}
          {(view.slurm_start ?? startedAt) && (
            <Row label="Started">
              <TimeStamp value={(view.slurm_start ?? startedAt)!} />
            </Row>
          )}
          {ended && (
            <Row label="Ended">
              <TimeStamp value={ended} />
            </Row>
          )}
        </dl>

        {parameters.variables.length > 0 && (
          <div className="mt-4 border-t pt-4">
            <div className="mb-1.5 text-xs text-muted-foreground">Output variables</div>
            <Variables variables={parameters.variables} />
          </div>
        )}

        {/* Only when the draft chose: the snapshot's own is not known here. */}
        {parameters.post_processing && (
          <div className="mt-4 border-t pt-4">
            <div className="mb-1.5 text-xs text-muted-foreground">Output</div>
            <div className="text-sm text-foreground">{describeOutput(parameters.post_processing)}</div>
          </div>
        )}
      </div>
    </section>
  );
}
