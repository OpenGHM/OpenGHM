"use client";

import { useId } from "react";
import { AlertTriangle, Cpu, Info, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ComputeFields } from "@/components/workspace/compute-fields";
import { DraftCard } from "@/components/workspace/draft-card";
import { draftField } from "@/components/workspace/draft-field";
import { DraftStepHeading } from "@/components/workspace/draft-step-heading";
import { RunStartNote } from "@/components/workspace/run-start-note";
import { UNSUPPORTED_REASON, type Recommended } from "@/lib/jobs/compute";
import { checkAggregationWindowFor } from "@/lib/jobs/aggregation-window";
import { checkRunStartFor, isRealDate, type RunStartProblem } from "@/lib/jobs/run-start";
import type { JobParameters, SlurmConfig } from "@/lib/jobs/types";
import {
  orderVariables,
  snapshotVariableOrder,
  type DraftContext,
  type DraftField,
} from "@/lib/workspace/draft-state";
import { FIELD_LABELS } from "@/lib/workspace/draft-wizard";

/** A variable the draft can be asked to write, and what to call it. */
interface VariableOption {
  name: string;
  /** The snapshot's own name for it with its unit; absent for a variable the
   *  snapshot does not list. */
  title: string | null;
}

/**
 * The server refused this start. Its message ends with "Start on X instead."
 * (app/services/run_start.py); `RunStartNote` already offers that as a button,
 * so the sentence is dropped from the text rather than printed twice.
 */
function serverStartProblem(refusal: { message: string; suggestion: string | null }): RunStartProblem {
  const tail = refusal.suggestion ? ` Start on ${refusal.suggestion} instead.` : null;
  const message = tail && refusal.message.endsWith(tail) ? refusal.message.slice(0, -tail.length) : refusal.message;
  return { message, suggestion: refusal.suggestion };
}

const CHECKBOX = "size-4 shrink-0 rounded border-border accent-primary";

/**
 * Step 3, "Run settings": run period, output variables, cores and walltime. It
 * also has to deal with what a draft can hold that this screen never creates, so
 * that it can be taken away (a submit refuses each of them, ADR 0025):
 * - a stored spatial subset can be switched off, not on;
 * - stored custom parameters can be removed;
 * - stored variables the snapshot does not list stay in the list, marked, until
 *   unticked.
 *
 * With no snapshot (`ctx.dataset` null) there is no coverage to bound the dates
 * by and no variable list beyond what is stored. Variables are stored in the
 * snapshot's own order (`orderVariables`), which `run_overrides` compares as
 * lists. Everything is controlled: the wizard owns the values and saves them.
 */
export function DraftRunStep({
  ctx,
  parameters,
  slurm,
  recommended,
  serverErrors,
  startRefusal,
  onParametersChange,
  onSlurmChange,
  disabled = false,
}: {
  ctx: DraftContext;
  parameters: JobParameters;
  slurm: SlurmConfig;
  /** The snapshot's own `recommendedCompute`; null when it could not be loaded. */
  recommended: Recommended | null;
  /** What the server said about a field it did not take. */
  serverErrors: Partial<Record<DraftField, string>>;
  /** The server's refusal of the current start (`useDraftAutosave().startRefusal`). */
  startRefusal: { message: string; suggestion: string | null } | null;
  onParametersChange: (parameters: JobParameters) => void;
  onSlurmChange: (slurm: SlurmConfig) => void;
  /** Everything off, while a submit is under way. */
  disabled?: boolean;
}) {
  const id = useId();
  const dataset = ctx.dataset;
  const coverage = dataset?.simulation.temporalCoverage ?? null;
  const set = (change: Partial<JobParameters>) => onParametersChange({ ...parameters, ...change });

  // Dates.
  const { temporal_range_start: start, temporal_range_end: end } = parameters;
  const startProblem =
    checkRunStartFor(dataset, start) ?? (startRefusal ? serverStartProblem(startRefusal) : null);
  // What the note does not say: the date itself, or a refusal the server worded.
  // The snapshot's multi-year aggregation asks the run to reach a year; it says
  // which date is off, in words that name the allowed range.
  const aggregation = checkAggregationWindowFor(dataset, start, end);
  const startText = !isRealDate(start)
    ? "Choose a start date that exists."
    : startProblem === null
      ? (aggregation.start ?? serverErrors.start ?? null)
      : null;
  const startInvalid = startProblem !== null || startText !== null;
  const endText = !isRealDate(end)
    ? "Choose an end date that exists."
    : isRealDate(start) && start > end
      ? "The end date is before the start date."
      : (aggregation.end ?? serverErrors.end ?? null);

  // Variables: the snapshot's, in its order, then the stored ones it does not list.
  const listed: VariableOption[] =
    dataset?.simulation.outputVariables.map((v) => ({
      name: v.name,
      title: `${v.fullName} (${v.unit})`,
    })) ?? [];
  const known = new Set(listed.map((v) => v.name));
  const options: VariableOption[] = [
    ...listed,
    ...parameters.variables.filter((name) => !known.has(name)).map((name) => ({ name, title: null })),
  ];
  const toggle = (name: string) => {
    const next = parameters.variables.includes(name)
      ? parameters.variables.filter((v) => v !== name)
      : [...parameters.variables, name];
    set({ variables: orderVariables(next, snapshotVariableOrder(ctx)) });
  };
  const variablesText = serverErrors.variables ?? null;

  // Cases the toolkit cannot run.
  const spatial = parameters.spatial_domain;
  const custom = parameters.custom_params;
  const customEntries = custom ? Object.entries(custom) : [];
  const computeErrors = (["cores", "walltime"] as const).flatMap((field) =>
    serverErrors[field] ? [{ field, message: serverErrors[field] as string }] : []
  );

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-6 border-0 p-0">
      <DraftStepHeading step="run">
        The run period, the output variables, and how much compute to ask Anvil for.
      </DraftStepHeading>

      <DraftCard title="Run period & output variables" icon={Settings2}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-start`} className="text-xs text-muted-foreground">
              Start
            </Label>
            <Input
              id={`${id}-start`}
              {...draftField("start")}
              type="date"
              className="h-10 md:h-9"
              min={coverage?.start}
              max={coverage?.end}
              value={start}
              aria-invalid={startInvalid || undefined}
              aria-describedby={`${id}-start-note${startText ? ` ${id}-start-error` : ""}`}
              onChange={(e) => set({ temporal_range_start: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-end`} className="text-xs text-muted-foreground">
              End
            </Label>
            <Input
              id={`${id}-end`}
              {...draftField("end")}
              type="date"
              className="h-10 md:h-9"
              min={coverage?.start}
              max={coverage?.end}
              value={end}
              aria-invalid={endText !== null || undefined}
              aria-describedby={endText ? `${id}-end-error` : undefined}
              onChange={(e) => set({ temporal_range_end: e.target.value })}
            />
            {endText && (
              <p id={`${id}-end-error`} className="text-xs text-destructive">
                {endText}
              </p>
            )}
          </div>
        </div>
        <RunStartNote
          id={`${id}-start-note`}
          alignment={dataset?.runStartAlignment ?? null}
          problem={startProblem}
          onUseSuggestion={(suggested) => set({ temporal_range_start: suggested })}
        />
        {startText && (
          <p id={`${id}-start-error`} className="text-xs text-destructive">
            {startText}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {coverage ? (
            <>
              The model snapshot covers{" "}
              <span className="font-medium text-foreground">
                {coverage.start} → {coverage.end}
              </span>
              .
            </>
          ) : (
            "The period the model snapshot covers isn't available, so the dates aren't checked against it here."
          )}
        </p>

        <fieldset {...draftField("variables")} className="min-w-0 space-y-2">
          <legend className="text-xs text-muted-foreground">
            Output variables ({parameters.variables.length}/{options.length})
          </legend>
          {options.length > 0 ? (
            <div
              aria-describedby={variablesText ? `${id}-variables-error` : undefined}
              className="grid max-h-56 grid-cols-1 gap-x-3 overflow-y-auto rounded-lg border p-2 min-[420px]:grid-cols-2 sm:grid-cols-3"
            >
              {options.map((v) => (
                <label
                  key={v.name}
                  className="flex min-h-10 cursor-pointer items-center gap-2 text-sm sm:min-h-8"
                >
                  <input
                    type="checkbox"
                    checked={parameters.variables.includes(v.name)}
                    onChange={() => toggle(v.name)}
                    className={CHECKBOX}
                  />
                  <span className="min-w-0 truncate" title={v.title ?? v.name}>
                    {v.name}
                  </span>{" "}
                  {v.title === null && dataset && (
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      not in this snapshot
                    </span>
                  )}
                </label>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No output variables are known for this draft.
            </p>
          )}
          {parameters.variables.length === 0 && (
            <p className="flex items-start gap-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              Choose at least one output variable. A simulation with none can&apos;t be submitted.
            </p>
          )}
          {!dataset && parameters.variables.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Only the variables already chosen are listed: the model snapshot&apos;s own list isn&apos;t
              available.
            </p>
          )}
          {variablesText && (
            <p id={`${id}-variables-error`} className="text-xs text-destructive">
              {variablesText}
            </p>
          )}
        </fieldset>

        <div className="space-y-2">
          {/* The toolkit has no option for a spatial subset, so a submit
              refuses one (ADR 0025): a stored one can be switched off. */}
          <label
            className={`flex min-h-10 items-center gap-2 text-xs font-medium sm:min-h-8 ${
              spatial ? "text-foreground" : "text-muted-foreground/60"
            }`}
          >
            <input
              type="checkbox"
              checked={spatial !== null}
              disabled={spatial === null}
              {...draftField("spatial")}
              aria-describedby={`${id}-spatial-note`}
              onChange={() => set({ spatial_domain: null })}
              className={CHECKBOX}
            />
            Restrict to a spatial subset
          </label>
          <p id={`${id}-spatial-note`} className="text-xs text-muted-foreground">
            {spatial
              ? "This draft has a spatial subset. Subsets other than the model snapshot's whole domain can't run yet: switch it off to submit."
              : UNSUPPORTED_REASON.spatialSubset}
          </p>
          {spatial && (
            <p className="font-mono text-xs text-muted-foreground">
              N{spatial.north} S{spatial.south} E{spatial.east} W{spatial.west}
            </p>
          )}
          {serverErrors.spatial && <p className="text-xs text-destructive">{serverErrors.spatial}</p>}
        </div>

        {customEntries.length > 0 && (
          <div className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p>
                This draft has custom parameters. {UNSUPPORTED_REASON.customParams} Remove them to
                submit.
              </p>
              <ul className="font-mono">
                {customEntries.map(([key, value]) => (
                  <li key={key} className="break-all">
                    {key} = {value}
                  </li>
                ))}
              </ul>
              {serverErrors.custom && <p className="text-destructive">{serverErrors.custom}</p>}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-10 shrink-0 bg-white sm:min-h-8"
              {...draftField("custom")}
              onClick={() => set({ custom_params: null })}
            >
              Remove
            </Button>
          </div>
        )}

        <div className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <p>
            Spin-up, routing and post-processing settings come from the model&apos;s{" "}
            <code className="font-mono">.init</code> file and can&apos;t be changed here.
          </p>
        </div>
      </DraftCard>

      {/* What SLURM is asked for. Account and partition are the gateway's, so
          only cores and walltime are here. */}
      <DraftCard title="Compute" icon={Cpu} tone="compute">
        <ComputeFields config={slurm} recommended={recommended} onChange={onSlurmChange} />
        {computeErrors.map(({ field, message }) => (
          <p key={field} className="text-xs text-destructive">
            {FIELD_LABELS[field]}: {message}
          </p>
        ))}
      </DraftCard>
    </fieldset>
  );
}
