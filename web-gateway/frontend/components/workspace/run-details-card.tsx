"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { TimeStamp } from "@/components/common/time-stamp";
import { clampClass } from "@/components/common/clamped-name";
import { CopyButton } from "@/components/workspace/copy-button";
import { describeOutput } from "@/components/workspace/output-choice-field";
import { useLiveJobContext } from "@/components/workspace/live-job-provider";
import {
  automaticWalltimeLabel,
  describeHours,
  effectiveCompute,
  parseSlurmTime,
  type Recommended,
} from "@/lib/jobs/compute";
import type { Job } from "@/lib/jobs/types";
import { secondsBetween, shortDuration } from "@/lib/workspace/timeline";
import { useNow } from "@/lib/workspace/use-now";
import { cn } from "@/lib/utils";

/** Variables drawn before "Show all". */
const VARIABLES_SHOWN = 6;

/** One fact of the card, drawn as the Data Repository's "Dataset Info" draws
 *  one: the label small and muted, the value under it, a hairline between rows.
 *  `mono` is for a value that is a date, a number or an id. */
function InfoRow({ label, mono = false, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-t py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 text-sm font-medium break-words text-foreground", mono && "font-mono text-[13px]")}>
        {children}
      </dd>
    </div>
  );
}

/** A figure of the navy Execution card: a small light label over a mono value. */
function Tile({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5 rounded-xl bg-white/6 p-3", wide && "col-span-2")}>
      <dt className="text-[11.5px] text-hero-eyebrow">{label}</dt>
      <dd className="min-w-0 font-mono text-[15px] break-words text-white">{children}</dd>
    </div>
  );
}

const MONO = "font-mono text-xs font-normal break-all";
const NOTE = "ml-1.5 text-xs font-normal text-muted-foreground";
const TILE_NOTE = "block font-sans text-[11.5px] font-normal text-hero-foreground-muted";

/** The output variables: how many, the first few, and the rest on request. */
function Variables({ variables }: { variables: string[] }) {
  const [all, setAll] = useState(false);
  const regionId = useId();
  const shown = all ? variables : variables.slice(0, VARIABLES_SHOWN);
  return (
    <div id={regionId} className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 font-mono text-[13px] font-medium">{variables.length}</span>
      {shown.map((v) => (
        <span key={v} className="rounded-full border px-2.5 py-[3px] font-mono text-xs font-normal text-foreground/80">
          {v}
        </span>
      ))}
      {variables.length > VARIABLES_SHOWN && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          aria-controls={regionId}
          className="min-h-10 rounded-md px-2 text-xs font-semibold text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8"
        >
          {all ? "Show fewer" : `Show all ${variables.length}`}
        </button>
      )}
    </div>
  );
}

/**
 * The times of the run, one row each, with how long the waiting and the running
 * took beside them: `Submitted` (and, while it waits, how long so far),
 * `Started` (waited 3 min), `Ended` (ran 14 min), and the moment a cancel was
 * asked for when the job ended after one. Times are the viewer's own after
 * hydration, UTC before it (`TimeStamp`); the durations are counted from the
 * same moments the status summary's verdict uses.
 */
function TimeRows({ job }: { job: Job }) {
  const { view, status, submittedAt, startedAt, completedAt } = useLiveJobContext();
  const now = useNow(30_000);
  if (!submittedAt) return null;

  const started = view.slurm_start ?? startedAt;
  const ended = view.slurm_end ?? completedAt;
  const ending = ["COMPLETED", "FAILED", "CANCELLED"].includes(status);
  const waited = secondsBetween(submittedAt, started);
  const ran = ending ? secondsBetween(started, ended) : null;
  // Still queued: how long so far, from the clock.
  const waiting =
    started === null && !ending && now !== null
      ? secondsBetween(submittedAt, new Date(now).toISOString())
      : null;
  const cancelRequested = view.cancel_requested_at ?? job.cancel_requested_at;

  return (
    <>
      <InfoRow mono label="Submitted">
        <TimeStamp value={submittedAt} />
        {waiting !== null && <span className={NOTE}>(waiting {shortDuration(waiting)})</span>}
      </InfoRow>
      {started && (
        <InfoRow mono label="Started">
          <TimeStamp value={started} />
          {waited !== null && <span className={NOTE}>(waited {shortDuration(waited)})</span>}
        </InfoRow>
      )}
      {cancelRequested && ending && (
        <InfoRow mono label="Cancel requested">
          <TimeStamp value={cancelRequested} />
        </InfoRow>
      )}
      {ending && ended && (
        <InfoRow mono label="Ended">
          <TimeStamp value={ended} />
          {ran !== null && <span className={NOTE}>(ran {shortDuration(ran)})</span>}
        </InfoRow>
      )}
    </>
  );
}

/**
 * The facts of a simulation past DRAFT, in the cards beside the page from `xl`
 * and after the status summary below it (`AsideLayout`), styled as the Data
 * Repository's detail page: "Run details", a white list like its "Dataset
 * Info" (what it is based on, a link to the snapshot, the run period and
 * domain, the output variables and output, the run id, the toolkit commit, the
 * times and where it wrote), and "Execution", a navy card like its "Container
 * & Execution" with the cores, the walltime and the Slurm job. Read-only. Everything the page says in more than one
 * place is said here only: the status summary has the path of a completed run's
 * results, so this card leaves it out then.
 *
 * Cores and walltime are what the job asked SLURM for: the draft's own choice,
 * else the model snapshot's recommendation worked out the way the submit does
 * (`effectiveCompute`, the backend's `resolve_compute`), marked as such. While
 * SLURM has the job, the limit it enforces is shown instead. A value that
 * cannot be known (no recommendation to read) is a dash, not a guess.
 * `postProcessing` says the run post-processed (`runsClimatology`), which the
 * recommendation includes the snapshot's post-processing time for.
 */
export function RunDetailsCard({
  job,
  recommended,
  postProcessing = false,
}: {
  job: Job;
  recommended: Recommended | null;
  postProcessing?: boolean;
}) {
  const { view, live, status } = useLiveJobContext();
  const { parameters, slurm_config: config } = job;
  const compute = effectiveCompute(config, recommended, postProcessing);

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
        : `(${automaticWalltimeLabel(false, "placeholder", compute.includesPostProcessing)})`
      : null;
  const coresNote = compute.cores !== null && compute.coresSource === "snapshot" ? "(recommended)" : null;
  const domain = parameters.spatial_domain;
  const workDir = view.work_dir ?? job.work_dir;
  const files = view.files ?? job.files;
  // A completed run's results (and their path) are the status summary's.
  const summaryHasPath = status === "COMPLETED" && files !== "purged";
  const slurmJobId = view.slurm_job_id ?? job.slurm_job_id;

  return (
    <div className="space-y-4">
      <section className="rounded-card bg-card px-6 pt-6 pb-3 shadow-raised">
        <h2 className="text-[17px] font-[650] tracking-[-0.02em]">Run details</h2>
        {/* Two columns where the card is the width of the page (`sm` up, below `xl`), one in the aside. */}
        <dl className="mt-2 grid gap-x-8 sm:grid-cols-2 xl:grid-cols-1">
          <InfoRow label="Based on">
            <Link
              href={`/repository/${job.dataset_id}`}
              title={job.dataset_title}
              className={`${clampClass(2)} text-primary transition-colors hover:text-primary-hover hover:underline`}
            >
              {job.dataset_title}
            </Link>
          </InfoRow>
          <InfoRow mono label="Run period">
            {parameters.temporal_range_start} &rarr; {parameters.temporal_range_end}
          </InfoRow>
          {domain && (
            <InfoRow label="Spatial domain">
              <span className="font-mono text-xs font-normal">
                N{domain.north}&deg; S{domain.south}&deg; E{domain.east}&deg; W{domain.west}&deg;
              </span>
            </InfoRow>
          )}
          {parameters.variables.length > 0 && (
            <InfoRow label="Output variables">
              <Variables variables={parameters.variables} />
            </InfoRow>
          )}
          {/* Only when the draft chose: the snapshot's own is not known here. */}
          {parameters.post_processing && (
            <InfoRow label="Post-processing">{describeOutput(parameters.post_processing)}</InfoRow>
          )}
          {job.sim_id && (
            <InfoRow label="Run ID">
              <span className={MONO}>{job.sim_id}</span>
            </InfoRow>
          )}
          {job.toolkit?.commit && (
            <InfoRow label="Toolkit commit">
              <span className={MONO}>{job.toolkit.commit}</span>
            </InfoRow>
          )}
          <TimeRows job={job} />
          {workDir && !summaryHasPath && (
            <InfoRow label="Work directory">
              <span className="flex items-start gap-2">
                <span className={`${MONO} min-w-0 flex-1`}>{workDir}</span>
                <CopyButton text={workDir} label="path" />
              </span>
            </InfoRow>
          )}
        </dl>
      </section>

      <section className="relative overflow-hidden rounded-card bg-hero p-6 text-white">
        <div aria-hidden="true" className="hero-dots pointer-events-none absolute inset-0 opacity-70" />
        <div className="relative space-y-4">
          <h2 className="text-[17px] font-[650] tracking-[-0.02em]">Execution</h2>
          <dl className="grid grid-cols-2 gap-2">
            <Tile label="Cores">
              {compute.cores ?? <span className="text-hero-foreground-muted">—</span>}
              {coresNote && <span className={TILE_NOTE}>{coresNote}</span>}
            </Tile>
            <Tile label="Walltime">
              {walltime ?? <span className="text-hero-foreground-muted">—</span>}
              {walltimeNote && <span className={TILE_NOTE}>{walltimeNote}</span>}
            </Tile>
            {slurmJobId && (
              <Tile label="Slurm job" wide>
                #{slurmJobId}
              </Tile>
            )}
          </dl>
        </div>
      </section>
    </div>
  );
}
