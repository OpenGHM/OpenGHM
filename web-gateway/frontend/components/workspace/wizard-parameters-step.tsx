"use client";

import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ComputeFields } from "@/components/workspace/compute-fields";
import { UNSUPPORTED_REASON } from "@/lib/jobs/compute";
import { recommendedComputeFor } from "@/lib/workspace/wizard-types";
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
        <CardHeader className="border-b bg-gradient-to-r from-primary/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
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
            {/* The toolkit has no option for a spatial subset, so a submit
                refuses one (ADR 0025): the control stays, switched off. */}
            <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground/60">
              <input
                type="checkbox"
                checked={false}
                disabled
                aria-describedby="spatial-subset-reason"
                className="size-3.5 rounded border-slate-300"
              />
              Restrict to a spatial subset
            </label>
            <p id="spatial-subset-reason" className="text-xs text-muted-foreground">
              {UNSUPPORTED_REASON.spatialSubset}
            </p>
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <p>
              Spin-up, routing and post-processing settings come from the model&apos;s{" "}
              <code className="font-mono">.init</code> file and can&apos;t be changed here.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Compute */}
      <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
        <CardHeader className="border-b bg-gradient-to-r from-compute/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
          <CardTitle className="text-lg font-semibold text-foreground">Compute</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-5 pb-6">
          <ComputeFields
            config={slurmConfig}
            recommended={recommendedComputeFor(snapshot)}
            onChange={onSlurmConfigChange}
          />
        </CardContent>
      </Card>
    </div>
  );
}
