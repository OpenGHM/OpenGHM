"use client";

import Link from "next/link";
import { Calendar, ExternalLink, Grid3X3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { BoundingBoxMap } from "@/components/repository/bounding-box-map-dynamic";
import { OutputVariablesTable } from "@/components/repository/output-variables-table";
import { TagChips } from "@/components/repository/tag-chips";
import { aboutName } from "@/lib/jobs/display-name";
import type { Dataset } from "@/lib/repository/types";

/**
 * The picker's "Details" surface: a sheet over the right edge, so the list
 * keeps its width. A subset of the full detail page (map, period, resolution,
 * output variables, model-input status), not a duplicate of it (spec.md open
 * question 1). Links out to the real page, in a new tab, so opening it doesn't
 * abandon the picker's own state.
 *
 * `dataset` stays set while the sheet slides out, so its content does not
 * vanish mid-animation; `open` is what shows it.
 */
export function SnapshotDetailSheet({
  dataset,
  open,
  modelInputIds,
  onOpenChange,
  action,
}: {
  dataset: Dataset;
  open: boolean;
  /** `null` while the model-input catalogue hasn't loaded yet. */
  modelInputIds: Set<string> | null;
  onOpenChange: (open: boolean) => void;
  /** The commit control, the same Select the list's rows have. */
  action: React.ReactNode;
}) {
  const { start, end } = dataset.simulation.temporalCoverage;
  const { value, unit } = dataset.simulation.resolution;
  const { northlimit, southlimit, eastlimit, westlimit } = dataset.simulation.spatialCoverage;
  const modelInputPresent = modelInputIds?.has(dataset.uses.modelInput.id) ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="text-base leading-snug break-words">
            {aboutName(dataset.about)}
          </SheetTitle>
          {dataset.about.shortName && dataset.about.shortName !== dataset.about.name && (
            <p className="text-xs leading-relaxed break-words text-muted-foreground">{dataset.about.name}</p>
          )}
          <TagChips tags={dataset.about.tags} />
        </SheetHeader>

        <SheetBody className="space-y-4">
          <SheetDescription className="leading-relaxed">{dataset.about.description}</SheetDescription>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Calendar aria-hidden="true" className="size-3.5" />
              {start} – {end}
            </span>
            <span className="inline-flex items-center gap-1">
              <Grid3X3 aria-hidden="true" className="size-3.5" />
              {value} {unit}
            </span>
          </div>

          <BoundingBoxMap north={northlimit} south={southlimit} east={eastlimit} west={westlimit} />

          <p className="text-xs font-medium text-muted-foreground">
            Model input:{" "}
            {modelInputPresent === null
              ? "checking…"
              : modelInputPresent
                ? "present in the catalogue"
                : "not listed in the catalogue"}
          </p>

          {dataset.simulation.outputVariables.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Output variables</p>
              <OutputVariablesTable variables={dataset.simulation.outputVariables} />
            </div>
          )}
        </SheetBody>

        <SheetFooter>
          <Button variant="ghost" size="sm" asChild className="h-10 sm:h-8">
            <Link href={`/repository/${dataset.id}`} target="_blank" rel="noopener noreferrer">
              Full details
              <ExternalLink aria-hidden="true" className="ml-1.5 size-3.5" />
            </Link>
          </Button>
          {action}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
