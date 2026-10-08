"use client";

import { useEffect, useId, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ComputeSection } from "@/components/workspace/compute-fields";
import { DraftBasis } from "@/components/workspace/draft-basis";
import { draftField } from "@/components/workspace/draft-field";
import { DraftPanel, DraftSection } from "@/components/workspace/draft-section";
import { DraftStepHeading } from "@/components/workspace/draft-step-heading";
import { OutputChoiceSection } from "@/components/workspace/output-choice-field";
import {
  OutputVariablesSection,
  type VariableOption,
} from "@/components/workspace/output-variables-field";
import { runsClimatology, type Recommended } from "@/lib/jobs/compute";
import { checkAggregationWindowFor } from "@/lib/jobs/aggregation-window";
import { describeRunPeriodLimits } from "@/lib/jobs/run-period";
import { checkRunStartFor, isRealDate, type RunStartProblem } from "@/lib/jobs/run-start";
import type { JobParameters, SlurmConfig } from "@/lib/jobs/types";
import type { ModelInput } from "@/lib/repository/types";
import {
  orderVariables,
  snapshotVariableOrder,
  type DraftContext,
  type DraftField,
} from "@/lib/workspace/draft-state";

/**
 * The server refused this start. Its message ends with "Start on X instead."
 * (app/services/run_start.py); the field offers that as a button, so the
 * sentence is dropped from the text rather than printed twice.
 */
function serverStartProblem(refusal: { message: string; suggestion: string | null }): RunStartProblem {
  const tail = refusal.suggestion ? ` Start on ${refusal.suggestion} instead.` : null;
  const message = tail && refusal.message.endsWith(tail) ? refusal.message.slice(0, -tail.length) : refusal.message;
  return { message, short: message, suggestion: refusal.suggestion };
}

/**
 * Step 2, "Run settings": what the draft is based on (a small card), then one
 * card whose first part is the snapshot draft's name and description (the first
 * thing a new draft asks for, so the Name takes focus when it has none and
 * `autoFocusName` is set), followed by the run period, the output variables,
 * the output (daily, monthly and yearly, or also climatology), and cores and
 * walltime. Most people keep the defaults, so the variables and compute are a line saying
 * what they hold and a button that opens them (`DraftCollapsible`); what is
 * wrong with them stays in view either way.
 *
 * The run period states what the snapshot allows once, in the line under the
 * two dates (`describeRunPeriodLimits`); a date that breaks it says so in red
 * under its own field, and a bad start offers the nearest good one.
 *
 * It also has to deal with what a draft can hold that this screen never
 * creates, so that it can be taken away (a submit refuses each of them, ADR
 * 0025). They are shown only when the draft has them:
 * - a stored spatial subset or custom parameters can be removed;
 * - a model input of the draft's own can be reverted to the snapshot's;
 * - stored variables the snapshot does not list stay in the list, marked, until
 *   unticked.
 *
 * With no snapshot (`ctx.dataset` null) there is no coverage to bound the dates
 * by and no variable list beyond what is stored. Variables are stored in the
 * snapshot's own order (`orderVariables`), which `run_overrides` compares as
 * lists. Everything is controlled: the wizard owns the values and saves them.
 *
 * `resolvedModelInput` is `useCatalogueModelInput(effectiveModelInputId(...))`,
 * looked up once by the wizard.
 */
export function DraftRunStep({
  datasetId,
  datasetTitle,
  ctx,
  parameters,
  slurm,
  recommended,
  modelInputId,
  resolvedModelInput,
  name,
  description,
  autoFocusName = false,
  serverErrors,
  startRefusal,
  onNameChange,
  onDescriptionChange,
  onParametersChange,
  onSlurmChange,
  onRevertModelInput,
  disabled = false,
}: {
  datasetId: string;
  datasetTitle: string;
  ctx: DraftContext;
  parameters: JobParameters;
  slurm: SlurmConfig;
  /** The snapshot's own `recommendedCompute`; null when it could not be loaded. */
  recommended: Recommended | null;
  /** The draft's own model input; null inherits the snapshot's. */
  modelInputId: string | null;
  resolvedModelInput: ModelInput | null | undefined;
  /** What the Name input holds: empty until the user names the snapshot draft. */
  name: string;
  description: string;
  /** Focus the Name input when the step opens (a new draft nobody has named). */
  autoFocusName?: boolean;
  /** What the server said about a field it did not take. */
  serverErrors: Partial<Record<DraftField, string>>;
  /** The server's refusal of the current start (`useDraftSaver().startRefusal`). */
  startRefusal: { message: string; suggestion: string | null } | null;
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string) => void;
  onParametersChange: (parameters: JobParameters) => void;
  onSlurmChange: (slurm: SlurmConfig) => void;
  onRevertModelInput: () => void;
  /** Everything off, while a submit is under way. */
  disabled?: boolean;
}) {
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  // Once, as the step opens. Moving to the step by Back or the strip sends focus
  // to its heading afterwards (the wizard's effect runs after this one).
  useEffect(() => {
    if (autoFocusName) nameRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dataset = ctx.dataset;
  const coverage = dataset?.simulation.temporalCoverage ?? null;
  const set = (change: Partial<JobParameters>) => onParametersChange({ ...parameters, ...change });

  // Dates.
  const { temporal_range_start: start, temporal_range_end: end } = parameters;
  const startProblem =
    checkRunStartFor(dataset, start) ?? (startRefusal ? serverStartProblem(startRefusal) : null);
  const aggregation = checkAggregationWindowFor(dataset, start, end);
  const startText = !isRealDate(start)
    ? "Choose a start date that exists."
    : (startProblem?.short ?? aggregation.startShort ?? serverErrors.start ?? null);
  const suggestion = isRealDate(start) ? (startProblem?.suggestion ?? null) : null;
  const endText = !isRealDate(end)
    ? "Choose an end date that exists."
    : isRealDate(start) && start > end
      ? "The end date is before the start date."
      : (aggregation.endShort ?? serverErrors.end ?? null);
  const limits = describeRunPeriodLimits(dataset);

  // Variables: the snapshot's, in its order, then the stored ones it does not list.
  const listed: VariableOption[] =
    dataset?.simulation.outputVariables.map((v) => ({
      name: v.name,
      title: `${v.fullName} (${v.unit})`,
      listed: true,
    })) ?? [];
  const known = new Set(listed.map((v) => v.name));
  const options: VariableOption[] = [
    ...listed,
    ...parameters.variables
      .filter((name) => !known.has(name))
      .map((name) => ({ name, title: null, listed: false })),
  ];

  // Cases the toolkit cannot run.
  const spatial = parameters.spatial_domain;
  const custom = parameters.custom_params;
  const customEntries = custom ? Object.entries(custom) : [];

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-6 border-0 p-0">
      <DraftStepHeading step="run">
        The run period, the output variables, and how much compute to ask Anvil for.
      </DraftStepHeading>

      <DraftBasis
        ctx={ctx}
        datasetId={datasetId}
        fallbackTitle={datasetTitle}
        modelInput={{
          id: modelInputId,
          resolved: resolvedModelInput,
          onRevert: onRevertModelInput,
          error: serverErrors.modelInput,
        }}
        disabled={disabled}
      />

      <DraftPanel>
        <DraftSection title="Name and description">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-name`} className="text-xs text-muted-foreground">
              Name
            </Label>
            <Input
              id={`${id}-name`}
              ref={nameRef}
              value={name}
              placeholder="e.g. Global 2000–2009 baseline"
              autoComplete="off"
              {...draftField("name")}
              className="h-10 md:h-9"
              aria-describedby={serverErrors.name ? `${id}-name-error` : undefined}
              aria-invalid={serverErrors.name ? true : undefined}
              onChange={(e) => onNameChange(e.target.value)}
            />
            {serverErrors.name && (
              <p id={`${id}-name-error`} className="text-xs text-destructive">
                {serverErrors.name}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-description`} className="text-xs text-muted-foreground">
              Description <span className="font-normal">(optional)</span>
            </Label>
            <textarea
              id={`${id}-description`}
              value={description}
              rows={2}
              placeholder="What is this snapshot draft for?"
              {...draftField("description")}
              aria-describedby={serverErrors.description ? `${id}-description-error` : undefined}
              aria-invalid={serverErrors.description ? true : undefined}
              onChange={(e) => onDescriptionChange(e.target.value)}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm"
            />
            {serverErrors.description && (
              <p id={`${id}-description-error`} className="text-xs text-destructive">
                {serverErrors.description}
              </p>
            )}
          </div>
        </DraftSection>

        <DraftSection title="Run period">
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
                aria-invalid={startText !== null || undefined}
                aria-describedby={`${id}-limits${startText ? ` ${id}-start-error` : ""}`}
                onChange={(e) => set({ temporal_range_start: e.target.value })}
              />
              <div aria-live="polite">
                {startText && (
                  <p id={`${id}-start-error`} className="text-xs text-destructive">
                    {startText}
                    {suggestion && (
                      <>
                        {" "}
                        <Button
                          type="button"
                          variant="link"
                          onClick={() => set({ temporal_range_start: suggestion })}
                          className="h-auto min-h-8 p-0 text-xs"
                        >
                          Use {suggestion}
                        </Button>
                      </>
                    )}
                  </p>
                )}
              </div>
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
                aria-describedby={`${id}-limits${endText ? ` ${id}-end-error` : ""}`}
                onChange={(e) => set({ temporal_range_end: e.target.value })}
              />
              <div aria-live="polite">
                {endText && (
                  <p id={`${id}-end-error`} className="text-xs text-destructive">
                    {endText}
                  </p>
                )}
              </div>
            </div>
          </div>
          <p id={`${id}-limits`} className="text-xs text-muted-foreground">
            {limits ??
              "The period the model snapshot covers isn't available, so the dates aren't checked against it here."}
          </p>
        </DraftSection>

        <OutputVariablesSection
          options={options}
          selected={parameters.variables}
          hasSnapshot={dataset !== null}
          onChange={(names) => set({ variables: orderVariables(names, snapshotVariableOrder(ctx)) })}
          error={serverErrors.variables ?? null}
          errorId={`${id}-variables-error`}
          describedBy={serverErrors.variables ? `${id}-variables-error` : undefined}
        />

        <OutputChoiceSection
          dataset={dataset}
          value={parameters.post_processing ?? null}
          variableCount={parameters.variables.length}
          error={serverErrors.postProcessing ?? null}
          onChange={(post_processing) => set({ post_processing })}
        />

        {(spatial !== null || customEntries.length > 0) && (
          <DraftSection title="Settings that can't run yet">
            {spatial !== null && (
              <div className="flex flex-col gap-2 text-xs text-warning sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    This draft has a spatial subset. Only the model snapshot&apos;s whole domain can run:
                    remove it to submit.
                  </p>
                  <p className="ml-5 font-mono text-muted-foreground">
                    N{spatial.north} S{spatial.south} E{spatial.east} W{spatial.west}
                  </p>
                  {serverErrors.spatial && <p className="ml-5 text-destructive">{serverErrors.spatial}</p>}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-10 shrink-0 sm:min-h-8"
                  {...draftField("spatial")}
                  onClick={() => set({ spatial_domain: null })}
                >
                  Remove
                </Button>
              </div>
            )}
            {customEntries.length > 0 && (
              <div className="flex flex-col gap-2 text-xs text-warning sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    This draft has custom parameters, which can&apos;t run yet: remove them to submit.
                  </p>
                  <ul className="ml-5 font-mono text-muted-foreground">
                    {customEntries.map(([key, value]) => (
                      <li key={key} className="break-all">
                        {key} = {value}
                      </li>
                    ))}
                  </ul>
                  {serverErrors.custom && <p className="ml-5 text-destructive">{serverErrors.custom}</p>}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-10 shrink-0 sm:min-h-8"
                  {...draftField("custom")}
                  onClick={() => set({ custom_params: null })}
                >
                  Remove
                </Button>
              </div>
            )}
          </DraftSection>
        )}

        {/* What SLURM is asked for. Account and partition are the gateway's, so
            only cores and walltime are here. */}
        <ComputeSection
          config={slurm}
          recommended={recommended}
          postProcessing={runsClimatology(parameters.post_processing, dataset?.postProcessing)}
          serverErrors={{ cores: serverErrors.cores, walltime: serverErrors.walltime }}
          onChange={onSlurmChange}
        />
      </DraftPanel>
    </fieldset>
  );
}
