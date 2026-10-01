"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Cpu,
  Globe,
  Info,
  Layers,
  Loader2,
  Lock,
  Rocket,
  Save,
  Send,
  Tag,
} from "lucide-react";
import Link from "next/link";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { describeSubmitFailure, SubmitSummary } from "@/components/workspace/submit-summary";
import {
  deriveSimulation,
  submitSimulation,
  updateSimulation,
} from "@/lib/jobs/actions";
import {
  describeSlurmTime,
  effectiveCompute,
  slurmConfigPatch,
  type Recommended,
} from "@/lib/jobs/compute";
import type { Dataset, ModelInput } from "@/lib/repository/types";
import type { ActionFailure, JobParameters, SlurmConfig } from "@/lib/jobs/types";
import type { ModelInputChoice } from "@/lib/workspace/wizard-types";
import { TagChips } from "@/components/repository/tag-chips";

function ModelInputSummary({
  choice,
  inherited,
  inheritedId,
}: {
  choice: ModelInputChoice;
  /** What step 2 found in the catalogue: `undefined` still looking, `null` not held. */
  inherited: ModelInput | null | undefined;
  inheritedId: string;
}) {
  if (choice.mode === "chosen") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-semibold text-foreground">Chosen</p>
          <p className="text-xs text-muted-foreground">{choice.modelInput.about.name}</p>
        </div>
      </div>
    );
  }
  const id = <code className="font-mono">{inheritedId.slice(0, 12)}…</code>;
  if (inherited) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-success/25 bg-success/5 p-3">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
        <div>
          <p className="text-sm font-semibold text-foreground">Inherited: {inherited.about.name}</p>
          <p className="text-xs text-muted-foreground">
            From the base model snapshot ({id}), found in the catalogue.
          </p>
        </div>
      </div>
    );
  }
  // Not held is not a problem for the run, which fetches the snapshot's model
  // input by its id (see step 2), so it is said plainly and not as a warning.
  return (
    <div className="flex items-start gap-2 rounded-lg border p-3">
      {inherited === undefined ? (
        <Loader2 className="mt-0.5 size-4 shrink-0 text-muted-foreground motion-safe:animate-spin" />
      ) : (
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <div>
        <p className="text-sm font-semibold text-foreground">Inherited</p>
        <p className="text-xs text-muted-foreground">
          {inherited === undefined ? (
            <>From the base model snapshot ({id}). Checking the catalogue…</>
          ) : (
            <>
              From the base model snapshot ({id}). The catalogue does not list it. The run
              fetches it by id, so this changes nothing about the run.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export function WizardReviewStep({
  snapshot,
  modelInputChoice,
  inheritedModelInput,
  parameters,
  slurmConfig,
  recommended,
  blockedReason,
}: {
  snapshot: Dataset;
  modelInputChoice: ModelInputChoice;
  /** What step 2 found in the catalogue for the snapshot's own model input:
   *  `undefined` while looking, `null` when it is not held. */
  inheritedModelInput: ModelInput | null | undefined;
  parameters: JobParameters;
  slurmConfig: SlurmConfig;
  recommended: Recommended;
  /** Why this user cannot submit (ADR 0024), or null. Saving a draft is
   *  always open to them. */
  blockedReason: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"save" | "submit" | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  // Set once the draft exists, so a retry after a failed submit submits the
  // same draft rather than making a second one.
  const [draftId, setDraftId] = useState<string | null>(null);

  const { start, end } = snapshot.simulation.temporalCoverage;
  const { value: resolutionValue, unit: resolutionUnit } = snapshot.simulation.resolution;
  const compute = effectiveCompute(slurmConfig, recommended);

  const fail = (result: ActionFailure) => {
    if (result.reason === "session_expired") {
      setSessionExpired(true);
      toast.error("Your session has expired.");
      return;
    }
    const message =
      result.reason === "error" ? describeSubmitFailure(result) : "This simulation no longer exists.";
    setError(message);
    toast.error(message);
  };

  /** The draft: derived from the snapshot, then given the parameters and the
   *  cores and walltime the wizard changed. Returns its id, or null after
   *  showing why not. */
  const saveDraft = async (): Promise<string | null> => {
    if (draftId) return draftId;
    const derived = await deriveSimulation(snapshot.id, {
      model_input_id: modelInputChoice.mode === "chosen" ? modelInputChoice.modelInput.id : undefined,
    });
    if (!derived.ok) {
      fail(derived);
      return null;
    }
    const patched = await updateSimulation(derived.data.id, {
      parameters,
      slurm_config: slurmConfigPatch(slurmConfig),
    });
    // The draft exists from here on, whether or not this PATCH took.
    setDraftId(derived.data.id);
    if (!patched.ok) {
      fail(patched);
      return null;
    }
    return derived.data.id;
  };

  const run = async (kind: "save" | "submit") => {
    if (pending) return;
    setPending(kind);
    setError(null);
    setSessionExpired(false);
    try {
      const id = await saveDraft();
      if (!id) return;
      if (kind === "save") {
        toast.success("Draft saved.");
        router.push(`/workspace/${id}`);
        return;
      }
      const submitted = await submitSimulation(id);
      if (!submitted.ok) {
        fail(submitted);
        return;
      }
      toast.success("Submitted to Anvil.");
      router.push(`/workspace/${id}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong. Check My Simulations before trying again.";
      setError(message);
      toast.error(message);
    } finally {
      setPending(null);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1024px] px-10 py-8">
      {sessionExpired && <SessionExpiredBanner className="mb-6" />}
      {error && (
        <div
          role="alert"
          className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm text-status-failed"
        >
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
                <TagChips tags={snapshot.about.tags} className="shrink-0 justify-end" />
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
                    <p className="text-xs font-medium text-muted-foreground">Model Snapshot Coverage</p>
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
              <ModelInputSummary
                choice={modelInputChoice}
                inherited={inheritedModelInput}
                inheritedId={snapshot.uses.modelInput.id}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="size-4 text-success" />
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
                      className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                    >
                      {v}
                    </span>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: compute + actions */}
        <div className="space-y-4">
          <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
            <CardHeader className="border-b bg-gradient-to-r from-compute/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
                <div className="flex size-8 items-center justify-center rounded-lg bg-compute/10">
                  <Cpu className="size-4 text-compute" aria-hidden="true" />
                </div>
                Compute
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-5 pb-6 text-sm">
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2">
                <span className="text-muted-foreground">Cluster</span>
                <span className="font-medium">Anvil (Purdue)</span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2">
                <span className="text-muted-foreground">Cores</span>
                <span className="text-right font-medium">
                  {compute.cores ?? "—"}
                  {compute.coresSource === "snapshot" && compute.cores !== null && (
                    <span className="block text-xs font-normal text-muted-foreground">
                      model snapshot&apos;s recommendation
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2">
                <span className="text-muted-foreground">Walltime</span>
                <span className="text-right font-medium">
                  {compute.walltime ? describeSlurmTime(compute.walltime) : "—"}
                  {compute.walltimeSource === "snapshot" && compute.walltime !== null && (
                    <span className="block text-xs font-normal text-muted-foreground">
                      model snapshot&apos;s recommendation + 50%
                    </span>
                  )}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
            <CardHeader className="border-b bg-gradient-to-r from-primary/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
                  <Rocket className="size-4 text-primary" aria-hidden="true" />
                </div>
                Save or run
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-5 pb-6">
              <p className="text-sm text-muted-foreground">
                Save this as a draft to keep editing it, or submit it to run on Anvil now.
              </p>

              {draftId && (
                <p className="text-sm text-muted-foreground">
                  Your draft was saved.{" "}
                  <Link href={`/workspace/${draftId}`} className="font-medium text-primary hover:underline">
                    Open it
                  </Link>
                </p>
              )}

              {blockedReason && (
                <div
                  id="wizard-submit-blocked"
                  className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground"
                >
                  <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <p>{blockedReason}</p>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void run("save")}
                  disabled={pending !== null || draftId !== null}
                  className="min-h-10 w-full font-semibold"
                >
                  {pending === "save" ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Save aria-hidden="true" />
                  )}
                  {pending === "save" ? "Saving…" : "Save as draft"}
                </Button>

                <AlertDialog
                  open={confirmOpen}
                  // Stay open while the request is in flight.
                  onOpenChange={(next) => {
                    if (pending === null) setConfirmOpen(next);
                  }}
                >
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      disabled={pending !== null || blockedReason !== null}
                      aria-describedby={blockedReason ? "wizard-submit-blocked" : undefined}
                      className="min-h-10 w-full font-semibold"
                    >
                      <Send aria-hidden="true" />
                      Submit
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Submit this simulation to Anvil?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This saves the draft and starts the run. It spends compute time. Check
                        the summary first.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <SubmitSummary
                      snapshotTitle={snapshot.about.name}
                      start={parameters.temporal_range_start}
                      end={parameters.temporal_range_end}
                      variables={parameters.variables}
                      cores={compute.cores}
                      coresFromSnapshot={compute.coresSource === "snapshot"}
                      walltime={compute.walltime}
                      walltimeFromSnapshot={compute.walltimeSource === "snapshot"}
                    />
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={pending !== null} className="min-h-10 sm:min-h-9">
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        disabled={pending !== null}
                        className="min-h-10 sm:min-h-9"
                        onClick={(event) => {
                          // Radix closes the dialog on Action; keep it open
                          // until the submit has answered.
                          event.preventDefault();
                          void run("submit");
                        }}
                      >
                        {pending === "submit" ? (
                          <>
                            <Loader2 className="animate-spin" aria-hidden="true" />
                            Submitting…
                          </>
                        ) : (
                          "Submit to Anvil"
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
