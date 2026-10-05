"use client";

import { useId, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { draftField } from "@/components/workspace/draft-field";
import { DraftCollapsible } from "@/components/workspace/draft-section";
import {
  describeComputeSummary,
  describeCoresBelowRecommended,
  describeCoresBelowRecommendedShort,
  describeDuration,
  describeWalltimeBelowReference,
  describeWalltimeOverLimit,
  describeWalltimeOverLimitShort,
  effectiveCompute,
  parseSlurmTime,
  secondsToHms,
  validateSlurmConfig,
  walltimeOverLimit,
  type Recommended,
} from "@/lib/jobs/compute";
import { MAX_CORES, type SlurmConfig } from "@/lib/jobs/types";

/** A warning in one line, with the long explanation one click away. */
function Warning({ id, short, why }: { id?: string; short: string; why: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div id={id} className="text-xs text-warning">
      <p className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">
          {short}{" "}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex min-h-8 items-center rounded font-medium underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {open ? "Hide" : "Why?"}
          </button>
        </span>
      </p>
      {open && <p className="ml-5 mt-1 break-words text-muted-foreground">{why}</p>}
    </div>
  );
}

/**
 * Cores and walltime for a draft: the two things a user may change about how
 * SLURM runs it, and a part of Run settings that most people leave alone. It
 * shows what the draft asks for in one line (`describeComputeSummary`:
 * "Recommended: 26 cores · 4 d (limit for one job)", or "Custom: 8 cores · 12
 * h") and a Change button that opens the two fields. Left empty, a field means
 * the snapshot's recommendation, which is its placeholder and is said once in
 * the line under the fields. The limits are the inputs' own (`max`) and are
 * spoken of only when a value is over them. The account and partition are the
 * gateway's (one shared allocation, ADR 0024), so they are not fields.
 *
 * What is wrong stays in view whether the fields are open or not. Two
 * warnings, each one line with the long reason behind "Why": cores below what
 * the snapshot recommends (memory comes with cores), and a snapshot whose
 * reference simulation is longer than one job may be, with no walltime set; and a
 * walltime shorter than the reference simulation, as a quiet note. A value that is
 * refused (here or by the server) keeps the fields open, with its message
 * under the field.
 */
export function ComputeSection({
  config,
  recommended,
  serverErrors = {},
  onChange,
}: {
  config: SlurmConfig;
  /** The snapshot's own `recommendedCompute`; null when it could not be loaded. */
  recommended: Recommended | null;
  /** What the server said about a value it did not take. */
  serverErrors?: { cores?: string; walltime?: string };
  onChange: (config: SlurmConfig) => void;
}) {
  const id = useId();
  const errors = validateSlurmConfig(config);
  const coresError = errors.cores ?? serverErrors.cores;
  const walltimeError = errors.walltime ?? serverErrors.walltime;
  // What an empty field means: the recommended cores, and its walltime plus
  // 50%, at most the limit for one job.
  const automatic = effectiveCompute({ cores: null, walltime: null }, recommended);
  const automaticSeconds = automatic.walltime ? parseSlurmTime(automatic.walltime) : null;
  const overLimit = walltimeOverLimit(config, recommended);
  const belowReference = describeWalltimeBelowReference(config, recommended);
  const coresWarning = describeCoresBelowRecommendedShort(config, recommended);
  const coresWarningId = coresWarning ? `${id}-cores-warning` : undefined;
  const walltimeNoteId = overLimit !== null || belowReference ? `${id}-walltime-note` : undefined;
  const summary = describeComputeSummary(config, recommended);

  const emptyMeans =
    recommended && automaticSeconds !== null
      ? `Empty = recommended: ${recommended.cores} ${recommended.cores === 1 ? "core" : "cores"}, ${describeDuration(automaticSeconds)}${
          automatic.walltimeCapped ? " (the limit for one job)" : ""
        }.`
      : "Empty = the model snapshot's recommendation.";

  return (
    <DraftCollapsible
      title="Compute"
      fields={["cores", "walltime"]}
      openLabel="Change"
      forceOpen={coresError !== undefined || walltimeError !== undefined}
      summary={summary.text}
      notes={
        <>
          {coresWarning && (
            <Warning
              id={coresWarningId}
              short={coresWarning}
              why={describeCoresBelowRecommended(config, recommended) as string}
            />
          )}
          {overLimit !== null && (
            <Warning
              id={walltimeNoteId}
              short={describeWalltimeOverLimitShort(overLimit)}
              why={describeWalltimeOverLimit(overLimit)}
            />
          )}
          {belowReference && (
            <p id={walltimeNoteId} className="text-xs text-muted-foreground">
              {belowReference}
            </p>
          )}
        </>
      }
    >
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
            placeholder={recommended ? String(recommended.cores) : "Recommended"}
            value={config.cores ?? ""}
            aria-invalid={coresError !== undefined}
            aria-describedby={
              [`${id}-compute-hint`, coresError ? `${id}-cores-error` : null, coresWarningId]
                .filter(Boolean)
                .join(" ")
            }
            onChange={(e) =>
              onChange({ ...config, cores: e.target.value === "" ? null : Number(e.target.value) })
            }
          />
          {coresError && (
            <p id={`${id}-cores-error`} className="text-xs text-destructive">
              {coresError}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-walltime`} className="text-xs text-muted-foreground">
            Walltime <span className="text-muted-foreground/80">(hh:mm:ss)</span>
          </Label>
          <Input
            id={`${id}-walltime`}
            {...draftField("walltime")}
            inputMode="numeric"
            className="h-10 md:h-9"
            placeholder={automaticSeconds !== null ? secondsToHms(automaticSeconds) : "HH:MM:SS"}
            value={config.walltime ?? ""}
            aria-invalid={walltimeError !== undefined}
            aria-describedby={
              [`${id}-compute-hint`, walltimeError ? `${id}-walltime-error` : null, walltimeNoteId]
                .filter(Boolean)
                .join(" ")
            }
            onChange={(e) =>
              onChange({ ...config, walltime: e.target.value === "" ? null : e.target.value })
            }
          />
          {walltimeError && (
            <p id={`${id}-walltime-error`} className="text-xs text-destructive">
              {walltimeError}
            </p>
          )}
        </div>
      </div>
      <p id={`${id}-compute-hint`} className="text-xs text-muted-foreground">
        {emptyMeans}
      </p>
    </DraftCollapsible>
  );
}
