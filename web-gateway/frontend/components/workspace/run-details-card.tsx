"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Ban,
  Calendar,
  Cpu,
  Database,
  FileOutput,
  Flag,
  Globe,
  Hash,
  HardDrive,
  Info,
  ListChecks,
  Play,
  Send,
  Server,
  Timer,
  Wrench,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TimeStamp } from "@/components/common/time-stamp";
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

/** Variables drawn before "Show all". */
const VARIABLES_SHOWN = 6;

/** One fact of the card, drawn as the Data Repository's "Dataset Info" draws
 *  one: a small icon, the label, the value. */
function InfoRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div aria-hidden="true" className="mt-0.5 shrink-0 text-primary [&_svg]:size-4">
        {icon}
      </div>
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 min-w-0 break-words text-sm font-medium text-foreground">{children}</dd>
      </div>
    </div>
  );
}

const MONO = "font-mono text-xs font-normal break-all";
const NOTE = "ml-1.5 text-xs font-normal text-muted-foreground";

/** The output variables: how many, the first few, and the rest on request. */
function Variables({ variables }: { variables: string[] }) {
  const [all, setAll] = useState(false);
  const regionId = useId();
  const shown = all ? variables : variables.slice(0, VARIABLES_SHOWN);
  return (
    <div id={regionId} className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-sm font-medium">{variables.length}</span>
      {shown.map((v) => (
        <span key={v} className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-normal text-foreground">
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
      <InfoRow icon={<Send />} label="Submitted">
        <TimeStamp value={submittedAt} />
        {waiting !== null && <span className={NOTE}>(waiting {shortDuration(waiting)})</span>}
      </InfoRow>
      {started && (
        <InfoRow icon={<Play />} label="Started">
          <TimeStamp value={started} />
          {waited !== null && <span className={NOTE}>(waited {shortDuration(waited)})</span>}
        </InfoRow>
      )}
      {cancelRequested && ending && (
        <InfoRow icon={<Ban />} label="Cancel requested">
          <TimeStamp value={cancelRequested} />
        </InfoRow>
      )}
      {ending && ended && (
        <InfoRow icon={<Flag />} label="Ended">
          <TimeStamp value={ended} />
          {ran !== null && <span className={NOTE}>(ran {shortDuration(ran)})</span>}
        </InfoRow>
      )}
    </>
  );
}

/**
 * The facts of a simulation past DRAFT, in the card beside the page from `xl`
 * and after the status summary below it (`AsideLayout`), styled as the Data
 * Repository's "Dataset Info": what it is based on (a link to the snapshot),
 * the run period and domain, the output variables and output, the cores and
 * walltime, the run's identity (Slurm job, run id, toolkit commit), the times
 * and where it wrote. Read-only. Everything the page says in more than one
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
    <Card className="gap-0 overflow-hidden rounded-xl border-0 py-0 shadow-sm">
      <CardHeader className="grid-rows-1 items-center bg-gradient-to-r from-hero to-primary !gap-0 !py-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-primary-foreground">
          <Info className="size-5" aria-hidden="true" />
          Run details
        </h2>
      </CardHeader>
      <CardContent className="pt-5 pb-6">
        {/* Two columns where the card is the width of the page (`sm` up, below `xl`), one in the aside. */}
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-1 xl:gap-y-3">
          <InfoRow icon={<Database />} label="Based on">
            <Link
              href={`/repository/${job.dataset_id}`}
              title={job.dataset_title}
              className="line-clamp-3 break-words text-primary transition-colors hover:text-accent hover:underline"
            >
              {job.dataset_title}
            </Link>
          </InfoRow>
          <InfoRow icon={<Calendar />} label="Run period">
            {parameters.temporal_range_start} &rarr; {parameters.temporal_range_end}
          </InfoRow>
          {domain && (
            <InfoRow icon={<Globe />} label="Spatial domain">
              <span className="font-mono text-xs font-normal">
                N{domain.north}&deg; S{domain.south}&deg; E{domain.east}&deg; W{domain.west}&deg;
              </span>
            </InfoRow>
          )}
          {parameters.variables.length > 0 && (
            <InfoRow icon={<ListChecks />} label="Output variables">
              <Variables variables={parameters.variables} />
            </InfoRow>
          )}
          {/* Only when the draft chose: the snapshot's own is not known here. */}
          {parameters.post_processing && (
            <InfoRow icon={<FileOutput />} label="Output">
              {describeOutput(parameters.post_processing)}
            </InfoRow>
          )}
          <InfoRow icon={<Cpu />} label="Cores">
            {compute.cores ?? <span className="font-normal text-muted-foreground">—</span>}
            {coresNote && <span className={NOTE}>{coresNote}</span>}
          </InfoRow>
          <InfoRow icon={<Timer />} label="Walltime">
            {walltime ?? <span className="font-normal text-muted-foreground">—</span>}
            {walltimeNote && <span className={NOTE}>{walltimeNote}</span>}
          </InfoRow>
          {slurmJobId && (
            <InfoRow icon={<Server />} label="Slurm job">
              <span className={MONO}>#{slurmJobId}</span>
            </InfoRow>
          )}
          {job.sim_id && (
            <InfoRow icon={<Hash />} label="Run ID">
              <span className={MONO}>{job.sim_id}</span>
            </InfoRow>
          )}
          {job.toolkit?.commit && (
            <InfoRow icon={<Wrench />} label="Toolkit commit">
              <span className={MONO}>{job.toolkit.commit}</span>
            </InfoRow>
          )}
          <TimeRows job={job} />
          {workDir && !summaryHasPath && (
            <InfoRow icon={<HardDrive />} label="Work directory">
              <span className="flex items-start gap-2">
                <span className={`${MONO} min-w-0 flex-1`}>{workDir}</span>
                <CopyButton text={workDir} label="path" />
              </span>
            </InfoRow>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}
