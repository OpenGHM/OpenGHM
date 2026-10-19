"use client";

import { useId, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { draftField } from "@/components/workspace/draft-field";
import {
  DraftSection,
  FIELD_HINT,
  FIELD_INPUT,
  FIELD_LABEL,
} from "@/components/workspace/draft-section";
import {
  describeCoresBelowRecommended,
  describeCoresBelowRecommendedShort,
  validateSlurmConfig,
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
 * Cores for a draft: the one thing a user may change about how SLURM runs it,
 * a field under "Compute" with what is recommended under it ("Recommended
 * 64"). Left empty, it means the snapshot's recommendation, which is its
 * placeholder. The limit is the input's own (`max`) and is spoken of only when
 * a value is over it. The walltime is not the user's (it is the snapshot's
 * recommendation with headroom, and the run is held to a time limit), and the
 * account and partition are the gateway's (one shared allocation, ADR 0024),
 * so none of them is a field.
 *
 * A warning stands above the field, one line with the long reason behind
 * "Why": cores below what the snapshot recommends (memory comes with cores). A
 * value that is refused (here or by the server) has its message under the
 * field.
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
  serverErrors?: { cores?: string };
  onChange: (config: SlurmConfig) => void;
}) {
  const id = useId();
  const errors = validateSlurmConfig(config);
  const coresError = errors.cores ?? serverErrors.cores;
  const coresWarning = describeCoresBelowRecommendedShort(config, recommended);
  const coresWarningId = coresWarning ? `${id}-cores-warning` : undefined;

  return (
    <DraftSection title="Compute" help="compute">
      {coresWarning && (
        <Warning
          id={coresWarningId}
          short={coresWarning}
          why={describeCoresBelowRecommended(config, recommended) as string}
        />
      )}
      <div className="grid gap-3.5 sm:grid-cols-2">
        <div className="space-y-[7px]">
          <Label htmlFor={`${id}-cores`} className={FIELD_LABEL}>
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
            className={`${FIELD_INPUT} font-mono md:text-sm`}
            placeholder={recommended ? String(recommended.cores) : "Recommended"}
            value={config.cores ?? ""}
            aria-invalid={coresError !== undefined}
            aria-describedby={
              [recommended ? `${id}-cores-hint` : null, coresError ? `${id}-cores-error` : null, coresWarningId]
                .filter(Boolean)
                .join(" ") || undefined
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
          {recommended && (
            <p id={`${id}-cores-hint`} className={FIELD_HINT}>
              Recommended {recommended.cores}
            </p>
          )}
        </div>
      </div>
    </DraftSection>
  );
}
