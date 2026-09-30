import { notFound } from "next/navigation";
import { pathWithQuery } from "@/lib/auth-redirect";
import { redirectToSignIn, requireSession } from "@/lib/auth-guard";
import Link from "next/link";
import { Header } from "@/components/landing/header";
import { Footer } from "@/components/landing/footer";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { JobStatusPanel } from "@/components/workspace/job-status-panel";
import { LogViewer } from "@/components/workspace/log-viewer";
import { LiveJobProvider } from "@/components/workspace/live-job-provider";
import { SimulationEditor } from "@/components/workspace/simulation-editor";
import { AboutSummaryCard } from "@/components/workspace/about-summary-card";
import { SubmitSimulationButton } from "@/components/workspace/submit-simulation-button";
import { DeleteSimulationButton } from "@/components/workspace/delete-simulation-button";
import { fetchMe } from "@/lib/account/actions";
import { fetchJob } from "@/lib/jobs/actions";
import { describeSlurmTime, submitBlockedReason } from "@/lib/jobs/compute";
import { fetchDatasetById } from "@/lib/repository/actions";
import { previewSimulation, fakeLogs, fakeLive } from "@/lib/workspace/fixtures";
import { resolvePreview } from "@/lib/workspace/preview";
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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const here = pathWithQuery(`/workspace/${encodeURIComponent(id)}`, query);
  await requireSession(here);

  const previewRaw = Array.isArray(query.preview) ? query.preview[0] : query.preview;
  const preview = resolvePreview(previewRaw);

  // The signed-in user, fetched at most once: a draft needs it for who may
  // submit, a cancelled job for "you cancelled this".
  let mePromise: ReturnType<typeof fetchMe> | null = null;
  const me = () => (mePromise ??= fetchMe());

  let job;
  if (preview) {
    const viewerEmail = preview.key.startsWith("cancel") ? ((await me())?.email ?? null) : null;
    job = previewSimulation(preview.key, { overrides: { id }, viewerEmail });
  } else {
    const result = await fetchJob(id);
    if (!result.ok) {
      if (result.reason === "session_expired") redirectToSignIn(here);
      if (result.reason === "not_found") notFound();
      throw new Error(result.message);
    }
    job = result.data;
  }

  const isDraft = job.status === "DRAFT";
  const isPreview = preview !== null;

  // Only needed while editable — gives the parameter editor the snapshot's
  // own output variables to choose from, in addition to whatever the
  // simulation already carries. Best-effort: a missing/unreadable source
  // dataset shouldn't block editing what the simulation already has.
  const dataset = isDraft ? await fetchDatasetById(job.dataset_id).catch(() => null) : null;
  const availableVariables = dataset?.simulation.outputVariables.map((v) => v.name) ?? [];
  // Whether this user may submit (ADR 0024), so the button can say why not
  // before the click. A failed lookup leaves it to the backend's answer.
  const blockedReason = isPreview
    ? "This is a design preview; nothing can be submitted from it."
    : isDraft
      ? submitBlockedReason(await me())
      : null;
  const viewerEmail = job.status === "CANCELLED" ? ((await me())?.email ?? null) : null;

  const previewLogs = isPreview ? fakeLogs(job.status) : undefined;
  const previewParam = preview ? `?preview=${preview.key}` : "";

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      {process.env.NODE_ENV !== "production" && (
        <DevPreviewSwitcher jobId={id} active={preview?.key ?? null} />
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
      <div className="bg-gradient-to-r from-hero to-primary py-8">
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
              <SimulationEditor job={job} availableVariables={availableVariables} dataset={dataset} />

              {/* Right column */}
              <div className="space-y-6">
                <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                  <CardContent className="flex items-start gap-3 py-4 text-sm">
                    <PencilLine className="mt-0.5 size-4 shrink-0 text-status-draft" />
                    <div>
                      <p className="font-medium text-foreground">Draft</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Not yet submitted to Anvil HPC. Everything on the left is
                        editable until then.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <SubmitSimulationButton
                  job={job}
                  recommended={dataset?.simulation.recommendedCompute ?? null}
                  blockedReason={blockedReason}
                />

                <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                  <CardContent className="py-4">
                    <Link
                      href={`/repository/${job.dataset_id}`}
                      className="flex items-center gap-2 text-sm font-medium text-primary transition-colors hover:text-accent"
                    >
                      <Database className="size-4" />
                      View Dataset
                    </Link>
                  </CardContent>
                </Card>

                <DeleteSimulationButton
                  jobId={job.id}
                  isDraft
                  workDir={null}
                  remoteJobDir={null}
                  files={null}
                  preview={isPreview}
                />
              </div>
            </div>
          ) : (
            // One poll loop for the whole grid: the status panel, the queue and
            // progress cards and the logs all read the same answer.
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
                live: isPreview ? fakeLive(job) : null,
              }}
              preview={isPreview}
            >
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
              {/* Left column — read-only once past DRAFT */}
              <div className="space-y-8">
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
                        <Database className="size-4 text-compute" />
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

              {/* Right column — Status */}
              <div className="space-y-6">
                <JobStatusPanel preview={isPreview} />

                {(job.status === "PENDING" || job.status === "SUBMITTED") && (
                  <QueuedNoticeCard status={job.status} />
                )}

                {(job.status === "RUNNING" || job.status === "COMPLETING") && (
                  <RunningProgressCard />
                )}

                {job.status === "COMPLETED" && (
                  <CompletedResultsCard
                    job={job}
                    publishHref={`/workspace/${job.id}/publish${previewParam}`}
                    preview={isPreview}
                  />
                )}

                {job.status === "FAILED" && (
                  <FailedNextStepsCard job={job} preview={isPreview} />
                )}

                {job.status === "CANCELLED" && (
                  <CancelledNoticeCard job={job} viewerEmail={viewerEmail} preview={isPreview} />
                )}

                {/* Dataset link */}
                <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
                  <CardContent className="py-4">
                    <Link
                      href={`/repository/${job.dataset_id}`}
                      className="flex items-center gap-2 text-sm font-medium text-primary transition-colors hover:text-accent"
                    >
                      <Database className="size-4" />
                      View Dataset
                    </Link>
                  </CardContent>
                </Card>
              </div>
            </div>
            </LiveJobProvider>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
