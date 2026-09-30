"use client";

import Link from "next/link";
import { Calendar, ExternalLink, Grid3X3, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BoundingBoxMap } from "@/components/repository/bounding-box-map-dynamic";
import { OutputVariablesTable } from "@/components/repository/output-variables-table";
import type { Dataset } from "@/lib/repository/types";

/**
 * The picker's "clicking the name" surface — a subset of the full detail
 * page (map, period, resolution, output variables, model-input status),
 * not a duplicate of it (spec.md open question 1). Links out to the real
 * page, in a new tab, so opening it doesn't abandon the picker's own state.
 */
export function SnapshotDetailPanel({
  dataset,
  modelInputIds,
  onClose,
  action,
}: {
  dataset: Dataset;
  modelInputIds: Set<string> | null;
  onClose: () => void;
  /** The commit control, rendered the same way the table's row action is. */
  action: React.ReactNode;
}) {
  const { start, end } = dataset.simulation.temporalCoverage;
  const { value, unit } = dataset.simulation.resolution;
  const { northlimit, southlimit, eastlimit, westlimit } = dataset.simulation.spatialCoverage;
  const modelInputPresent = modelInputIds?.has(dataset.uses.modelInput.id) ?? null;

  return (
    <Card className="sticky top-24">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold leading-snug text-foreground">
              {dataset.about.name}
            </h3>
            <span className="mt-1 inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
              {dataset.about.category}
            </span>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">
          {dataset.about.description}
        </p>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Calendar className="size-3.5" />
            {start} – {end}
          </span>
          <span className="inline-flex items-center gap-1">
            <Grid3X3 className="size-3.5" />
            {value} {unit}
          </span>
        </div>

        <BoundingBoxMap north={northlimit} south={southlimit} east={eastlimit} west={westlimit} />

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            Model input:{" "}
            {modelInputPresent === null
              ? "checking…"
              : modelInputPresent
                ? "present in the catalogue"
                : "not found (inherited-missing)"}
          </p>
        </div>

        {dataset.simulation.outputVariables.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Output variables</p>
            <OutputVariablesTable variables={dataset.simulation.outputVariables} />
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/repository/${dataset.id}`} target="_blank" rel="noopener noreferrer">
              Full details
              <ExternalLink className="ml-1.5 size-3.5" />
            </Link>
          </Button>
          {action}
        </div>
      </CardContent>
    </Card>
  );
}
