import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { JobStatusPanel } from "@/components/workspace/job-status-panel";
import { JobHero } from "@/components/workspace/job-hero";
import { LogViewer } from "@/components/workspace/log-viewer";
import { LiveJobProvider } from "@/components/workspace/live-job-provider";
import { SimulationEditor } from "@/components/workspace/simulation-editor";
import { AboutSummaryCard } from "@/components/workspace/about-summary-card";
import { QueuedNoticeCard } from "@/components/workspace/queued-notice-card";
import { RunningProgressCard } from "@/components/workspace/running-progress-card";
import { CompletedResultsCard } from "@/components/workspace/completed-results-card";
import { FailedNextStepsCard } from "@/components/workspace/failed-next-steps-card";
import { CancelledNoticeCard } from "@/components/workspace/cancelled-notice-card";
import { describeSlurmTime } from "@/lib/jobs/compute";
import { checkRunStartFor } from "@/lib/jobs/run-start";
import type { Job, JobLive, LogStream } from "@/lib/jobs/types";
import type { Dataset } from "@/lib/repository/types";
import {
  Calendar,
  Globe,
  Layers,
  Settings2,
  Cpu,
  PencilLine,
} from "lucide-react";

/**
 * The job detail page below the site header: breadcrumb, hero with the actions
 * for the job's status, and the cards. One view for two routes: the real page
 * (`app/workspace/[id]`) renders it from the backend, and the dev-only design
 * preview (`app/dev/workspace/[state]`) from the fixtures, with `preview` set.
 * Fetching stays in the pages; nothing here reads a fixture.
 *
 * A DRAFT is editable and has nothing to follow. Every other status sits inside
 * one `LiveJobProvider`, hero included, so the header's actions and the cards
 * read the same poll.
 */
export function JobDetail({
  job,
  dataset,
  viewerEmail,
  blockedReason,
  preview = false,
  previewLogs,
  previewLive = null,
}: {
  job: Job;
  /** The base snapshot, for a draft's variable picker and compute defaults.
   *  Null when it could not be read, or once the job is past DRAFT. */
  dataset: Dataset | null;
  /** The signed-in user's email, for "you cancelled this". */
  viewerEmail: string | null;
  /** Why this user cannot submit (ADR 0024), or null. */
  blockedReason: string | null;
  /** Fixture data: nothing is polled and the dialogs send nothing. */
  preview?: boolean;
  /** The logs to show instead of fetching them. Preview only. */
  previewLogs?: Partial<Record<LogStream, string>>;
  /** What SLURM would have said. Preview only. */
  previewLive?: JobLive | null;
}) {
  const isDraft = job.status === "DRAFT";
  // Gives the parameter editor the snapshot's own output variables to choose
  // from, in addition to whatever the simulation already carries.
  const availableVariables = dataset?.simulation.outputVariables.map((v) => v.name) ?? [];
  // Submitting runs the saved draft, so its saved start is what counts.
  const startRefused = isDraft && checkRunStartFor(dataset, job.parameters.temporal_range_start) !== null;
  const submitBlockedReason =
    blockedReason ??
    (startRefused
      ? "This draft's start date doesn't suit the model. Change it under Simulation Parameters and save."
      : null);
  const name = job.sim_id || job.slurm_job_name || job.id.slice(0, 8);

  const page = (
    <>
      {/* Breadcrumb */}
      <div className="border-b bg-muted/50">
        <div className="mx-auto max-w-[1280px] px-4 py-3 text-sm text-muted-foreground sm:px-10">
          <Link
            href="/workspace"
            className="transition-colors hover:text-foreground"
          >
            My Simulations
          </Link>
          <span className="mx-2">/</span>
          <span className="break-all font-mono text-foreground">{name}</span>
        </div>
      </div>

      <JobHero
        job={job}
        recommended={dataset?.simulation.recommendedCompute ?? null}
        blockedReason={submitBlockedReason}
        preview={preview}
      />

      <main className="flex-1 bg-slate-50">
        <div className="mx-auto max-w-[1280px] px-4 py-10 sm:px-10">
          {isDraft ? (
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
              {/* The notice comes first in reading order so a phone shows it above the
                  editor; from lg it sits in the right column. */}
              <div className="space-y-6 lg:col-start-2 lg:row-start-1">
                <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                  <CardContent className="flex items-start gap-3 py-4 text-sm">
                    <PencilLine className="mt-0.5 size-4 shrink-0 text-status-draft" />
                    <div>
                      <p className="font-medium text-foreground">Draft</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Not yet submitted to Anvil HPC. Everything on this page is
                        editable until then. Submitting runs the last saved
                        version, so save your changes first.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Editable while DRAFT */}
              <div className="min-w-0 lg:col-start-1 lg:row-start-1">
                <SimulationEditor job={job} availableVariables={availableVariables} dataset={dataset} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
              {/* Status first in reading order, so a phone shows the verdict above the
                  details; from lg it sits in the right column. */}
              <div className="min-w-0 space-y-6 lg:col-start-2 lg:row-start-1">
                <JobStatusPanel preview={preview} />

                {(job.status === "PENDING" || job.status === "SUBMITTED") && (
                  <QueuedNoticeCard status={job.status} />
                )}

                {(job.status === "RUNNING" || job.status === "COMPLETING") && (
                  <RunningProgressCard />
                )}

                {job.status === "COMPLETED" && <CompletedResultsCard job={job} />}

                {job.status === "FAILED" && <FailedNextStepsCard job={job} />}

                {job.status === "CANCELLED" && (
                  <CancelledNoticeCard job={job} viewerEmail={viewerEmail} />
                )}
              </div>

              {/* Read-only once past DRAFT */}
              <div className="min-w-0 space-y-8 lg:col-start-1 lg:row-start-1">
                <AboutSummaryCard about={job.about} />

                {/* Simulation Parameters */}
                <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                  <CardHeader className="border-b bg-gradient-to-r from-primary/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
                        <Settings2 className="size-4 text-primary" />
                      </div>
                      Simulation Parameters
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-5 pb-6">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="rounded-lg bg-muted p-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Calendar className="size-3" />
                          Temporal Range
                        </div>
                        <p className="mt-1 font-medium text-foreground">
                          {job.parameters.temporal_range_start} &mdash;{" "}
                          {job.parameters.temporal_range_end}
                        </p>
                      </div>
                      {job.parameters.spatial_domain && (
                        <div className="rounded-lg bg-muted p-3">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Globe className="size-3" />
                            Spatial Domain
                          </div>
                          <p className="mt-1 font-mono text-xs font-medium text-foreground">
                            N{job.parameters.spatial_domain.north}&deg; S
                            {job.parameters.spatial_domain.south}&deg; E
                            {job.parameters.spatial_domain.east}&deg; W
                            {job.parameters.spatial_domain.west}&deg;
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Variables */}
                    {job.parameters.variables.length > 0 && (
                      <div>
                        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <Layers className="size-3" />
                          Output Variables ({job.parameters.variables.length})
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {job.parameters.variables.map((v) => (
                            <span
                              key={v}
                              className="rounded-full border border-success/25 bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success"
                            >
                              {v}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Slurm Config */}
                <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                  <CardHeader className="border-b bg-gradient-to-r from-compute/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-compute/10">
                        <Cpu className="size-4 text-compute" />
                      </div>
                      HPC Configuration
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-5 pb-6">
                    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                      {[
                        {
                          label: "Cores",
                          value: job.slurm_config.cores ?? "Snapshot's recommendation",
                        },
                        {
                          label: "Walltime",
                          value: job.slurm_config.walltime
                            ? describeSlurmTime(job.slurm_config.walltime)
                            : "Snapshot's recommendation + 50%",
                        },
                        {
                          label: "Toolkit commit",
                          value: job.toolkit?.commit ?? null,
                          mono: true,
                        },
                        {
                          label: "Work directory",
                          value: job.work_dir,
                          mono: true,
                        },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="min-w-0 rounded-lg bg-muted p-3"
                        >
                          <dt className="text-xs text-muted-foreground">
                            {item.label}
                          </dt>
                          <dd
                            className={`mt-0.5 break-words font-medium text-foreground ${
                              item.mono ? "font-mono text-xs" : ""
                            }`}
                          >
                            {String(item.value ?? "—")}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </CardContent>
                </Card>

                {/* Logs */}
                <LogViewer previewLogs={previewLogs} />
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );

  if (isDraft) return page;

  // One poll loop for the whole page: the header, the status panel, the queue
  // and progress cards and the logs all read the same answer.
  return (
    <LiveJobProvider
      jobId={job.id}
      initialStatus={job.status}
      initialData={{
        slurm_job_id: job.slurm_job_id,
        submitted_at: job.submitted_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        status_reason: job.status_reason,
        work_dir: job.work_dir,
        slurm_state: job.slurm_state,
        slurm_exit_code: job.slurm_exit_code,
        slurm_start: job.slurm_start,
        slurm_end: job.slurm_end,
        failure: job.failure,
        cancel_requested_at: job.cancel_requested_at,
        cancel_requested_by_email: job.cancel_requested_by_email,
        files: job.files,
        output: job.output,
        live: previewLive,
      }}
      preview={preview}
    >
      {page}
    </LiveJobProvider>
  );
}
