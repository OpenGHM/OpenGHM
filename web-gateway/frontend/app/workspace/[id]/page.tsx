import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { JobStatusPanel } from "@/components/workspace/job-status-panel";
import { JobLogsPanel } from "@/components/workspace/job-logs-panel";
import { SimulationEditor } from "@/components/workspace/simulation-editor";
import { AboutSummaryCard } from "@/components/workspace/about-summary-card";
import { fetchJob } from "@/lib/jobs/actions";
import { fetchDatasetById } from "@/lib/repository/actions";
import { fakeSimulation, fakeLogs, fakeOutputFiles, fakeProgress } from "@/lib/workspace/fixtures";
import { resolvePreviewStatus } from "@/lib/workspace/preview";
import { DevPreviewSwitcher } from "@/components/workspace/dev-preview-switcher";
import { QueuedNoticeCard } from "@/components/workspace/queued-notice-card";
import { RunningProgressCard } from "@/components/workspace/running-progress-card";
import { CompletedResultsCard } from "@/components/workspace/completed-results-card";
import { FailedNextStepsCard } from "@/components/workspace/failed-next-steps-card";
import { CancelledNoticeCard } from "@/components/workspace/cancelled-notice-card";
import {
  ArrowLeft,
  Calendar,
  Globe,
  Layers,
  Settings2,
  Database,
  PencilLine,
} from "lucide-react";

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/auth/signin");

  const { id } = await params;
  const { preview: previewRaw } = await searchParams;
  const previewStatus = resolvePreviewStatus(previewRaw);

  const job = previewStatus ? fakeSimulation(previewStatus, { id }) : await fetchJob(id);
  if (!job) notFound();

  const isDraft = job.status === "DRAFT";
  const isPreview = previewStatus !== null;

  // Only needed while editable — gives the parameter editor the snapshot's
  // own output variables to choose from, in addition to whatever the
  // simulation already carries. Best-effort: a missing/unreadable source
  // dataset shouldn't block editing what the simulation already has.
  const dataset = isDraft ? await fetchDatasetById(job.dataset_id).catch(() => null) : null;
  const availableVariables = dataset?.simulation.outputVariables.map((v) => v.name) ?? [];

  const previewLogs = isPreview ? fakeLogs(job.status, job.id) : undefined;
  const previewParam = previewStatus ? `?preview=${previewStatus}` : "";

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      {process.env.NODE_ENV !== "production" && (
        <DevPreviewSwitcher jobId={id} active={previewStatus} />
      )}

      {/* Breadcrumb */}
      <div className="border-b bg-muted/50">
        <div className="mx-auto max-w-[1280px] px-10 py-3 text-sm text-muted-foreground">
          <Link
            href="/workspace"
            className="transition-colors hover:text-foreground"
          >
            My Simulations
          </Link>
          <span className="mx-2">/</span>
          <span className="text-foreground font-mono">
            {job.sim_id || job.slurm_job_name || job.id.slice(0, 8)}
          </span>
        </div>
      </div>

      {/* Hero */}
      <div className="bg-gradient-to-r from-[#0a192f] to-[#006994] py-8">
        <div className="mx-auto max-w-[1280px] px-10">
          <h1 className="text-xl font-bold text-white md:text-2xl">
            {job.dataset_title}
          </h1>
          <p className="mt-1 font-mono text-sm text-white/60">
            {job.sim_id || job.slurm_job_name || job.id.slice(0, 8)}
            {job.slurm_job_id ? ` · Slurm #${job.slurm_job_id}` : ""}
          </p>
        </div>
      </div>

      <main className="flex-1 bg-slate-50">
        <div className="mx-auto max-w-[1280px] px-10 py-10">
          <div className="mb-6">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/workspace">
                <ArrowLeft className="mr-1.5 size-4" />
                Back to Simulations
              </Link>
            </Button>
          </div>

          {isDraft ? (
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
              {/* Left column — editable while DRAFT */}
              <SimulationEditor job={job} availableVariables={availableVariables} />

              {/* Right column */}
              <div className="space-y-6">
                <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                  <CardContent className="flex items-start gap-3 py-4 text-sm">
                    <PencilLine className="mt-0.5 size-4 shrink-0 text-violet-600" />
                    <div>
                      <p className="font-medium text-foreground">Draft</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Not yet submitted to Anvil HPC. Everything above is
                        editable until then.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                  <CardContent className="py-4">
                    <Link
                      href={`/repository/${job.dataset_id}`}
                      className="flex items-center gap-2 text-sm font-medium text-[#006994] transition-colors hover:text-[#00b4d8]"
                    >
                      <Database className="size-4" />
                      View Dataset
                    </Link>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
              {/* Left column — read-only once past DRAFT */}
              <div className="space-y-8">
                <AboutSummaryCard about={job.about} />

                {/* Simulation Parameters */}
                <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                  <CardHeader className="border-b bg-gradient-to-r from-[#006994]/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-[#006994]/10">
                        <Settings2 className="size-4 text-[#006994]" />
                      </div>
                      Simulation Parameters
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-5 pb-6">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="rounded-lg bg-slate-50 p-3">
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
                        <div className="rounded-lg bg-slate-50 p-3">
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
                              className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700"
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
                  <CardHeader className="border-b bg-gradient-to-r from-violet-500/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
                    <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-violet-500/10">
                        <Database className="size-4 text-violet-600" />
                      </div>
                      HPC Configuration
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-5 pb-6">
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      {[
                        {
                          label: "Partition",
                          value: job.slurm_config.partition,
                        },
                        { label: "Account", value: job.slurm_config.account },
                        { label: "Walltime", value: job.slurm_config.walltime },
                        { label: "Nodes", value: job.slurm_config.nodes },
                        { label: "Tasks", value: job.slurm_config.ntasks },
                        {
                          label: "Memory",
                          value: job.slurm_config.memory || "Default",
                        },
                      ].map((item) => (
                        <div
                          key={item.label}
                          className="rounded-lg bg-slate-50 p-3"
                        >
                          <dt className="text-xs text-muted-foreground">
                            {item.label}
                          </dt>
                          <dd className="mt-0.5 font-medium text-foreground">
                            {String(item.value ?? "—")}
                          </dd>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Logs */}
                <JobLogsPanel
                  jobId={job.id}
                  jobStatus={job.status}
                  previewLogs={previewLogs}
                />
              </div>

              {/* Right column — Status */}
              <div className="space-y-6">
                <JobStatusPanel
                  jobId={job.id}
                  initialStatus={job.status}
                  initialData={{
                    slurm_job_id: job.slurm_job_id,
                    submitted_at: job.submitted_at,
                    started_at: job.started_at,
                    completed_at: job.completed_at,
                    status_reason: job.status_reason,
                  }}
                  preview={isPreview}
                />

                {(job.status === "PENDING" || job.status === "SUBMITTED") && (
                  <QueuedNoticeCard status={job.status} />
                )}

                {(job.status === "RUNNING" || job.status === "COMPLETING") && (
                  <RunningProgressCard
                    progress={isPreview ? fakeProgress() : undefined}
                    startedAt={job.started_at}
                  />
                )}

                {job.status === "COMPLETED" && (
                  <CompletedResultsCard
                    jobId={job.id}
                    files={fakeOutputFiles()}
                    publishHref={`/workspace/${job.id}/publish${previewParam}`}
                  />
                )}

                {job.status === "FAILED" && (
                  <FailedNextStepsCard
                    statusReason={job.status_reason}
                    datasetId={job.dataset_id}
                  />
                )}

                {job.status === "CANCELLED" && (
                  <CancelledNoticeCard
                    statusReason={job.status_reason}
                    datasetId={job.dataset_id}
                  />
                )}

                {/* Dataset link */}
                <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                  <CardContent className="py-4">
                    <Link
                      href={`/repository/${job.dataset_id}`}
                      className="flex items-center gap-2 text-sm font-medium text-[#006994] transition-colors hover:text-[#00b4d8]"
                    >
                      <Database className="size-4" />
                      View Dataset
                    </Link>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
