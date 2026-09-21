"use client";

import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { Dataset } from "@/lib/repository/types";
import type { JobParameters, SlurmConfig } from "@/lib/jobs/types";

export function WizardParametersStep({
  snapshot,
  parameters,
  slurmConfig,
  onParametersChange,
  onSlurmConfigChange,
}: {
  snapshot: Dataset;
  parameters: JobParameters;
  slurmConfig: SlurmConfig;
  onParametersChange: (parameters: JobParameters) => void;
  onSlurmConfigChange: (slurmConfig: SlurmConfig) => void;
}) {
  const spatialEnabled = parameters.spatial_domain !== null;

  const toggleVar = (name: string) => {
    const has = parameters.variables.includes(name);
    onParametersChange({
      ...parameters,
      variables: has
        ? parameters.variables.filter((v) => v !== name)
        : [...parameters.variables, name],
    });
  };

  return (
    <div className="mx-auto max-w-[1024px] space-y-6 px-10 py-8">
      {/* Temporal range + variables */}
      <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
        <CardHeader className="border-b bg-gradient-to-r from-[#006994]/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
          <CardTitle className="text-lg font-semibold text-foreground">
            Temporal Range &amp; Output Variables
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 pt-5 pb-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Start</Label>
              <Input
                type="date"
                min={snapshot.simulation.temporalCoverage.start}
                max={snapshot.simulation.temporalCoverage.end}
                value={parameters.temporal_range_start}
                onChange={(e) =>
                  onParametersChange({ ...parameters, temporal_range_start: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">End</Label>
              <Input
                type="date"
                min={snapshot.simulation.temporalCoverage.start}
                max={snapshot.simulation.temporalCoverage.end}
                value={parameters.temporal_range_end}
                onChange={(e) =>
                  onParametersChange({ ...parameters, temporal_range_end: e.target.value })
                }
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            The base snapshot covers{" "}
            <span className="font-medium text-foreground">
              {snapshot.simulation.temporalCoverage.start} → {snapshot.simulation.temporalCoverage.end}
            </span>
            .
          </p>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Output Variables ({parameters.variables.length}/
              {snapshot.simulation.outputVariables.length})
            </Label>
            <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto rounded-lg border p-3 sm:grid-cols-3">
              {snapshot.simulation.outputVariables.map((v) => (
                <label key={v.name} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={parameters.variables.includes(v.name)}
                    onChange={() => toggleVar(v.name)}
                    className="size-3.5 rounded border-slate-300"
                  />
                  <span className="truncate" title={`${v.fullName} (${v.unit})`}>
                    {v.name}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <input
                type="checkbox"
                checked={spatialEnabled}
                onChange={(e) =>
                  onParametersChange({
                    ...parameters,
                    spatial_domain: e.target.checked
                      ? { north: 0, south: 0, east: 0, west: 0 }
                      : null,
                  })
                }
                className="size-3.5 rounded border-slate-300"
              />
              Restrict to a spatial subset
            </label>
            {spatialEnabled && parameters.spatial_domain && (
              <div className="grid grid-cols-4 gap-3">
                {(["north", "south", "east", "west"] as const).map((edge) => (
                  <div key={edge} className="space-y-1">
                    <Label className="text-xs capitalize text-muted-foreground">{edge}</Label>
                    <Input
                      type="number"
                      value={parameters.spatial_domain![edge]}
                      onChange={(e) =>
                        onParametersChange({
                          ...parameters,
                          spatial_domain: {
                            ...parameters.spatial_domain!,
                            [edge]: Number(e.target.value) || 0,
                          },
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <p>
              Spinup, routing and post-processing settings live in the model&apos;s{" "}
              <code className="font-mono">.init</code> file, not here — the gateway shows the{" "}
              <code className="font-mono">.init</code> itself rather than restate it (see{" "}
              <code className="font-mono">docs/reference/metadata-format.md</code>).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* SLURM settings */}
      <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
        <CardHeader className="border-b bg-gradient-to-r from-[#006994]/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
          <CardTitle className="text-lg font-semibold text-foreground">SLURM Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-5 pb-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Partition</Label>
              <Input
                value={slurmConfig.partition ?? ""}
                onChange={(e) =>
                  onSlurmConfigChange({ ...slurmConfig, partition: e.target.value || null })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Account</Label>
              <Input
                placeholder="optional"
                value={slurmConfig.account ?? ""}
                onChange={(e) =>
                  onSlurmConfigChange({ ...slurmConfig, account: e.target.value || null })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Walltime</Label>
              <Input
                placeholder="hh:mm:ss"
                value={slurmConfig.walltime ?? ""}
                onChange={(e) =>
                  onSlurmConfigChange({ ...slurmConfig, walltime: e.target.value || null })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Nodes</Label>
              <Input
                type="number"
                min={1}
                value={slurmConfig.nodes ?? 1}
                onChange={(e) =>
                  onSlurmConfigChange({ ...slurmConfig, nodes: Number(e.target.value) || 1 })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Tasks</Label>
              <Input
                type="number"
                min={1}
                value={slurmConfig.ntasks ?? 1}
                onChange={(e) =>
                  onSlurmConfigChange({ ...slurmConfig, ntasks: Number(e.target.value) || 1 })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Memory</Label>
              <Input
                placeholder="optional, e.g. 32G"
                value={slurmConfig.memory ?? ""}
                onChange={(e) =>
                  onSlurmConfigChange({ ...slurmConfig, memory: e.target.value || null })
                }
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Defaulted from the snapshot&apos;s recommended compute (
            {snapshot.simulation.recommendedCompute.cores} cores,{" "}
            {snapshot.simulation.recommendedCompute.walltime}). Simulation editing does not yet
            accept SLURM sizing on a draft, so this is recorded for review — the run will use
            cluster defaults until that lands.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
