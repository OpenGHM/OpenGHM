"use client";

import { useId } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { draftField } from "@/components/workspace/draft-field";
import {
  automaticWalltimeLabel,
  describeCoresBelowRecommended,
  describeSlurmTime,
  describeWalltimeBelowReference,
  describeWalltimeOverLimit,
  effectiveCompute,
  validateSlurmConfig,
  walltimeOverLimit,
  type Recommended,
} from "@/lib/jobs/compute";
import { MAX_CORES, MAX_WALLTIME, type SlurmConfig } from "@/lib/jobs/types";

/**
 * Cores and walltime for a draft — the two things a user may change about how
 * SLURM runs it. Left empty, a field means "the snapshot's recommendation",
 * which is shown as its placeholder. The account and partition are the
 * gateway's (one shared allocation, ADR 0024), so they are not fields.
 */
export function ComputeFields({
  config,
  recommended,
  onChange,
}: {
  config: SlurmConfig;
  /** The snapshot's own `recommendedCompute`; null when it could not be loaded. */
  recommended: Recommended | null;
  onChange: (config: SlurmConfig) => void;
}) {
  const id = useId();
  const errors = validateSlurmConfig(config);
  // What an empty walltime means: the recommendation plus 50%, at most the
  // limit for one job.
  const automatic = effectiveCompute({ cores: null, walltime: null }, recommended);
  const defaultWalltime = automatic.walltime;
  const overLimit = walltimeOverLimit(config, recommended);
  const belowReference = describeWalltimeBelowReference(config, recommended);
  const coresWarning = describeCoresBelowRecommended(config, recommended);
  const coresWarningId = coresWarning ? `${id}-cores-warning` : undefined;
  const walltimeNoteId = overLimit !== null || belowReference ? `${id}-walltime-note` : undefined;

  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-cores`} className="text-xs text-muted-foreground">
            Cores
          </Label>
          <Input
            id={`${id}-cores`}
            {...draftField("cores")}
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_CORES}
            step={1}
            className="h-10 md:h-9"
            placeholder={recommended ? `${recommended.cores} (recommended)` : "Recommended"}
            value={config.cores ?? ""}
            aria-invalid={errors.cores !== undefined}
            aria-describedby={
              [errors.cores ? `${id}-cores-error` : null, coresWarningId].filter(Boolean).join(" ") || undefined
            }
            onChange={(e) =>
              onChange({
                ...config,
                cores: e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
          {errors.cores && (
            <p id={`${id}-cores-error`} className="text-xs text-destructive">
              {errors.cores}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-walltime`} className="text-xs text-muted-foreground">
            Walltime
          </Label>
          <Input
            id={`${id}-walltime`}
            {...draftField("walltime")}
            inputMode="numeric"
            className="h-10 md:h-9"
            placeholder={
              defaultWalltime
                ? `${describeSlurmTime(defaultWalltime)} (${automaticWalltimeLabel(automatic.walltimeCapped, "placeholder")})`
                : "HH:MM:SS"
            }
            value={config.walltime ?? ""}
            aria-invalid={errors.walltime !== undefined}
            aria-describedby={
              [errors.walltime ? `${id}-walltime-error` : null, walltimeNoteId]
                .filter(Boolean)
                .join(" ") || undefined
            }
            onChange={(e) =>
              onChange({ ...config, walltime: e.target.value === "" ? null : e.target.value })
            }
          />
          {errors.walltime && (
            <p id={`${id}-walltime-error`} className="text-xs text-destructive">
              {errors.walltime}
            </p>
          )}
        </div>
      </div>
      {coresWarning && (
        <p id={coresWarningId} className="flex items-start gap-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{coresWarning}</span>
        </p>
      )}
      {overLimit !== null && (
        <p
          id={walltimeNoteId}
          className="flex items-start gap-2 text-xs text-warning"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{describeWalltimeOverLimit(overLimit)}</span>
        </p>
      )}
      {belowReference && (
        <p id={walltimeNoteId} className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{belowReference}</span>
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Leave a field empty to use the model snapshot&apos;s recommendation
        {recommended && defaultWalltime
          ? ` (${recommended.cores} cores, and ${describeSlurmTime(recommended.walltime)} plus 50%${
              automatic.walltimeCapped
                ? `, at most ${MAX_WALLTIME}, which is ${describeSlurmTime(defaultWalltime)}`
                : `, which is ${describeSlurmTime(defaultWalltime)}`
            })`
          : ""}
        . The most you can ask for is {MAX_CORES} cores and {MAX_WALLTIME}.
      </p>
    </div>
  );
}
