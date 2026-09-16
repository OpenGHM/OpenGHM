"use client";

import { useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play, X, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitJob } from "@/lib/jobs/actions";
import type { SnapshotDataset } from "@/lib/repository/types";

interface Props {
  dataset: SnapshotDataset;
}

/**
 * "Run this model" button + modal dialog for configuring and submitting
 * a simulation job. Renders inline on the dataset detail page.
 */
export function SubmitJobDialog({ dataset }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, startSubmit] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // -- Form state ---------------------------------------------------------
  const defaultTemporal = parseTemporal(dataset.temporalCoverage);
  const [startDate, setStartDate] = useState(defaultTemporal.start);
  const [endDate, setEndDate] = useState(defaultTemporal.end);

  const [selectedVars, setSelectedVars] = useState<Set<string>>(
    () => new Set(dataset.variablesMeasured.map((v) => v.name))
  );

  const [walltime, setWalltime] = useState("02:00:00");
  const [nodes, setNodes] = useState(1);
  const [ntasks, setNtasks] = useState(1);

  // -- Handlers -----------------------------------------------------------

  const toggleVar = useCallback((name: string) => {
    setSelectedVars((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handleSubmit = () => {
    setError(null);
    startSubmit(async () => {
      try {
        const res = await submitJob({
          dataset_id: dataset.id,
          parameters: {
            temporal_range_start: startDate,
            temporal_range_end: endDate,
            spatial_domain: dataset.spatialCoverage
              ? {
                  north: dataset.spatialCoverage.northlimit,
                  south: dataset.spatialCoverage.southlimit,
                  east: dataset.spatialCoverage.eastlimit,
                  west: dataset.spatialCoverage.westlimit,
                }
              : null,
            variables: Array.from(selectedVars),
            custom_params: null,
          },
          slurm_config: {
            walltime,
            nodes,
            ntasks,
          },
        });

        setOpen(false);
        toast.success("Simulation submitted.");
        router.push(`/simulations/${res.job_id}`);
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Submission failed";
        setError(msg);
        toast.error(msg);
      }
    });
  };

  return (
    <>
      {/* Trigger button */}
      <Button
        size="lg"
        onClick={() => setOpen(true)}
        className="gap-2 bg-emerald-600 px-6 text-base font-semibold shadow-md hover:bg-emerald-700"
      >
        <Play className="size-5 fill-white" />
        Run this snapshot
      </Button>

      {/* Modal backdrop + dialog */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => !submitting && setOpen(false)}
          />

          {/* Dialog */}
          <div className="relative z-10 mx-4 w-full max-w-lg rounded-xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold text-foreground">
                Run Simulation
              </h2>
              <button
                onClick={() => !submitting && setOpen(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-slate-100 hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Body */}
            <div className="max-h-[70vh] overflow-y-auto px-6 py-5 space-y-5">
              {/* Dataset info */}
              <div className="rounded-lg bg-slate-50 p-3 text-sm">
                <p className="font-medium text-foreground">{dataset.title}</p>
                <p className="text-xs text-muted-foreground">
                  {dataset.format} &middot; {dataset.spatialResolution}
                </p>
              </div>

              {/* Temporal range */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Temporal Range</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">Start</Label>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">End</Label>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Output variables */}
              {dataset.variablesMeasured.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Output Variables ({selectedVars.size}/
                    {dataset.variablesMeasured.length})
                  </Label>
                  <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto rounded-lg border p-3">
                    {dataset.variablesMeasured.map((v) => (
                      <label
                        key={v.name}
                        className="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedVars.has(v.name)}
                          onChange={() => toggleVar(v.name)}
                          className="size-3.5 rounded border-slate-300"
                        />
                        <span className="truncate" title={v.name}>
                          {v.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Advanced (collapsible) */}
              <div>
                <button
                  type="button"
                  className="flex w-full items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setAdvancedOpen(!advancedOpen)}
                >
                  <ChevronDown
                    className={`size-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                  />
                  Advanced Settings
                </button>

                {advancedOpen && (
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Walltime
                      </Label>
                      <Input
                        value={walltime}
                        onChange={(e) => setWalltime(e.target.value)}
                        placeholder="HH:MM:SS"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Nodes</Label>
                      <Input
                        type="number"
                        min={1}
                        value={nodes}
                        onChange={(e) => setNodes(Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Tasks</Label>
                      <Input
                        type="number"
                        min={1}
                        value={ntasks}
                        onChange={(e) => setNtasks(Number(e.target.value))}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 border-t px-6 py-4">
              <Button
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting || selectedVars.size === 0}
              >
                {submitting ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Play className="mr-1.5 size-4" />
                )}
                Submit Job
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTemporal(temporal: string): { start: string; end: string } {
  // "2000-01-01/2010-12-31" or "static" or "2000 - 2010"
  const isoMatch = temporal.match(
    /(\d{4}-\d{2}-\d{2})\s*[/–-]\s*(\d{4}-\d{2}-\d{2})/
  );
  if (isoMatch) return { start: isoMatch[1], end: isoMatch[2] };

  const yearMatch = temporal.match(/(\d{4})\s*[-–]\s*(\d{4})/);
  if (yearMatch)
    return { start: `${yearMatch[1]}-01-01`, end: `${yearMatch[2]}-12-31` };

  return { start: "2000-01-01", end: "2020-12-31" };
}
