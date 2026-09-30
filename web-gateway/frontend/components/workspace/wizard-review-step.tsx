"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Cpu,
  Globe,
  Layers,
  Loader2,
  Rocket,
  Tag,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { deriveSimulation, updateSimulation } from "@/lib/jobs/actions";
import type { Dataset } from "@/lib/repository/types";
import type { JobParameters, SlurmConfig } from "@/lib/jobs/types";
import type { ModelInputChoice } from "@/lib/workspace/wizard-types";

function ModelInputSummary({ choice, inheritedId }: { choice: ModelInputChoice; inheritedId: string }) {
  if (choice.mode === "chosen") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-[#006994]/30 bg-[#006994]/5 p-3">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#006994]" />
        <div>
          <p className="text-sm font-semibold text-foreground">Chosen</p>
          <p className="text-xs text-muted-foreground">{choice.modelInput.about.name}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-lg border p-3">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <div>
        <p className="text-sm font-semibold text-foreground">Inherited</p>
        <p className="text-xs text-muted-foreground">
          From the base snapshot (<code className="font-mono">{inheritedId.slice(0, 12)}…</code>).
          Resolved when the simulation is created — may turn out to be{" "}
          <span className="font-medium">inherited-missing</span> if the catalogue does not hold it.
        </p>
      </div>
    </div>
  );
}

export function WizardReviewStep({
  snapshot,
  modelInputChoice,
  parameters,
  slurmConfig,
}: {
  snapshot: Dataset;
  modelInputChoice: ModelInputChoice;
  parameters: JobParameters;
  slurmConfig: SlurmConfig;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const { start, end } = snapshot.simulation.temporalCoverage;
  const { value: resolutionValue, unit: resolutionUnit } = snapshot.simulation.resolution;

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    setSessionExpired(false);
    try {
      // Real creation path (mission 2026-09-21): derive a DRAFT from the
      // base snapshot, optionally overriding its model input up front,
      // then patch in whatever parameters the wizard changed from the
      // snapshot's own defaults. SLURM sizing isn't sent — SimulationUpdateRequest
      // has no slurm_config field yet (app/models/job.py) — it stays local
      // to this review, not persisted.
      const derived = await deriveSimulation(snapshot.id, {
        model_input_id: modelInputChoice.mode === "chosen" ? modelInputChoice.modelInput.id : undefined,
      });
      const result = derived.ok
        ? await updateSimulation(derived.data.id, { parameters })
        : derived;
      if (!result.ok) {
        if (result.reason === "session_expired") {
          setSessionExpired(true);
          toast.error("Your session has expired.");
        } else {
          const msg = result.reason === "error" ? result.message : "Failed to create simulation";
          setError(msg);
          toast.error(msg);
        }
        setSubmitting(false);
        return;
      }

      toast.success("Simulation created.");
      router.push(`/workspace/${result.data.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create simulation";
      setError(msg);
      toast.error(msg);
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1024px] px-10 py-8">
      {sessionExpired && <SessionExpiredBanner className="mb-6" />}
      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: snapshot + parameters */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-base">{snapshot.about.name}</CardTitle>
                <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                  {snapshot.about.category}
                </span>
              </div>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {snapshot.uses.container.image}:{snapshot.uses.container.version}
              </p>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground leading-relaxed">{snapshot.about.description}</p>
              <div className="grid gap-3 pt-2 sm:grid-cols-2">
                <div className="flex items-start gap-2">
                  <Calendar className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Snapshot Coverage</p>
                    <p className="font-medium">
                      {start} → {end}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Spatial Resolution</p>
                    <p className="font-medium">
                      {resolutionValue} {resolutionUnit}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Tag className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">License</p>
                    <p className="font-medium">{snapshot.about.license}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Model Input</CardTitle>
            </CardHeader>
            <CardContent>
              <ModelInputSummary choice={modelInputChoice} inheritedId={snapshot.uses.modelInput.id} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="size-4 text-emerald-600" />
                Run Parameters
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
                <span className="text-muted-foreground">Temporal range</span>
                <span className="font-medium">
                  {parameters.temporal_range_start} → {parameters.temporal_range_end}
                </span>
              </div>
              {parameters.spatial_domain && (
                <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
                  <span className="text-muted-foreground">Spatial subset</span>
                  <span className="font-mono text-xs font-medium">
                    N{parameters.spatial_domain.north} S{parameters.spatial_domain.south} E
                    {parameters.spatial_domain.east} W{parameters.spatial_domain.west}
                  </span>
                </div>
              )}
              <div>
                <p className="mb-1.5 text-xs text-muted-foreground">
                  Output variables ({parameters.variables.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {parameters.variables.map((v) => (
                    <span
                      key={v}
                      className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700"
                    >
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: SLURM + submit */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Cpu className="size-4 text-blue-600" />
                SLURM Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
                <span className="text-muted-foreground">Cluster</span>
                <span className="font-medium">Anvil (Purdue)</span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
                <span className="text-muted-foreground">Partition</span>
                <span className="font-medium">{slurmConfig.partition ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
                <span className="text-muted-foreground">Walltime</span>
                <span className="font-medium">{slurmConfig.walltime ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
                <span className="text-muted-foreground">Nodes / Tasks</span>
                <span className="font-medium">
                  {slurmConfig.nodes ?? "—"} / {slurmConfig.ntasks ?? "—"}
                </span>
              </div>
              <p className="pt-1 text-xs text-muted-foreground">
                Not yet persisted — the simulation is created with cluster defaults until draft
                editing accepts SLURM sizing.
              </p>
            </CardContent>
          </Card>

          <Card className="border-[#006994]/20 bg-[#006994]/5">
            <CardContent className="space-y-3 pt-5">
              <p className="text-sm text-muted-foreground">
                This creates a draft simulation from the snapshot above. Nothing runs yet — WBM
                execution isn&apos;t wired up on the backend.
              </p>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full bg-[#006994] hover:bg-[#005a7a] font-semibold"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Rocket className="mr-2 size-4" />
                    Submit Simulation
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
