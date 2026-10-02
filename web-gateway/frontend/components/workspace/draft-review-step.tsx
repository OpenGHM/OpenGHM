"use client";

import { useId, type ReactNode } from "react";
import { AlertTriangle, Cpu, FileText, Layers, Pencil, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DraftCard, SummaryRow } from "@/components/workspace/draft-card";
import { draftField } from "@/components/workspace/draft-field";
import { DraftStepHeading } from "@/components/workspace/draft-step-heading";
import { ModelInputStatus } from "@/components/workspace/model-input-panel";
import { SnapshotSummaryCard } from "@/components/workspace/snapshot-summary-card";
import {
  automaticWalltimeLabel,
  describeCoresBelowRecommended,
  describeSlurmTime,
  effectiveCompute,
  type Recommended,
} from "@/lib/jobs/compute";
import type { ModelInput } from "@/lib/repository/types";
import type { DraftContext, DraftField, DraftLocal, SubmitProblem } from "@/lib/workspace/draft-state";
import { FIELD_LABELS, type DraftStep } from "@/lib/workspace/draft-wizard";

function EditButton({
  step,
  label,
  field,
  onEditStep,
}: {
  step: DraftStep;
  /** What the link edits, for its accessible name: "Edit run settings". */
  label: string;
  field?: DraftField;
  onEditStep: (step: DraftStep, field?: DraftField) => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={`Edit ${label}`}
      onClick={() => onEditStep(step, field)}
      className="min-h-10 text-primary sm:min-h-8"
    >
      <Pencil className="size-3.5" aria-hidden="true" />
      Edit
    </Button>
  );
}

function NeedsAttention({
  problems,
  onEditStep,
}: {
  problems: readonly SubmitProblem[];
  onEditStep: (step: DraftStep, field?: DraftField) => void;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3 rounded-xl border border-warning/30 bg-warning/5 p-4"
    >
      <h3 id={headingId} className="flex items-center gap-2 text-base font-semibold text-warning">
        <AlertTriangle className="size-4" aria-hidden="true" />
        Needs attention
      </h3>
      <ul className="space-y-2">
        {problems.map((problem, i) => (
          <li
            key={`${problem.field ?? "draft"}-${i}`}
            className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
          >
            <p className="min-w-0 break-words text-sm text-foreground">
              {problem.field && <span className="font-medium">{FIELD_LABELS[problem.field]}: </span>}
              {problem.message}
            </p>
            {problem.field && (
              <EditButton
                step={problem.step}
                field={problem.field}
                label={FIELD_LABELS[problem.field].toLowerCase()}
                onEditStep={onEditStep}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <span className="block text-xs font-normal text-muted-foreground">{children}</span>;
}

/**
 * Step 4, "Review & submit": name and description, a summary of each part of the
 * draft with a way back to the step that edits it, what stands in the way of a
 * submit, and the submit card.
 *
 * Name and description describe this simulation, not a published snapshot, and
 * are the only inputs here. The Name's placeholder is `fallbackName`: what the
 * header and the list call the draft while it has no name. The snapshot card has no Edit (a draft's starting
 * point cannot change), only its repository link. `problems` is `submitProblems`;
 * each one with a field has an Edit link to the step that field is on, and
 * `onEditStep` receives that field too so the wizard can focus it. `submitCard`
 * is a `DraftSubmitCard` (it shares the wizard's save state, so the wizard builds
 * it). `modelInput` is the catalogue lookup shared with step 2.
 */
export function DraftReviewStep({
  datasetId,
  datasetTitle,
  fallbackName,
  ctx,
  local,
  recommended,
  modelInput,
  problems,
  serverErrors,
  onNameChange,
  onDescriptionChange,
  onEditStep,
  submitCard,
  disabled = false,
}: {
  datasetId: string;
  datasetTitle: string;
  /** What the draft is called with an empty name (`displayName`), shown as the
   *  Name's placeholder. */
  fallbackName: string;
  ctx: DraftContext;
  local: DraftLocal;
  recommended: Recommended | null;
  modelInput: ModelInput | null | undefined;
  problems: readonly SubmitProblem[];
  serverErrors: Partial<Record<DraftField, string>>;
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string) => void;
  onEditStep: (step: DraftStep, field?: DraftField) => void;
  submitCard: ReactNode;
  /** Everything off, while a submit is under way. */
  disabled?: boolean;
}) {
  const id = useId();
  const { parameters, slurm } = local;
  const compute = effectiveCompute(slurm, recommended);
  const coresWarning = describeCoresBelowRecommended(slurm, recommended);
  const spatial = parameters.spatial_domain;
  const customCount = parameters.custom_params ? Object.keys(parameters.custom_params).length : 0;

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-6 border-0 p-0">
      <DraftStepHeading step="review">
        Name your simulation, check each part, then submit it to run on Anvil.
      </DraftStepHeading>

      <DraftCard title="About this simulation" icon={FileText}>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`} className="text-xs text-muted-foreground">
            Name
          </Label>
          <Input
            id={`${id}-name`}
            value={local.name}
            placeholder={fallbackName}
            {...draftField("name")}
            className="h-10 md:h-9"
            aria-describedby={`${id}-about-hint${serverErrors.name ? ` ${id}-name-error` : ""}`}
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
            Description
          </Label>
          <textarea
            id={`${id}-description`}
            value={local.description}
            rows={3}
            placeholder="What is this simulation for?"
            {...draftField("description")}
            aria-describedby={`${id}-about-hint${serverErrors.description ? ` ${id}-description-error` : ""}`}
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
        <p id={`${id}-about-hint`} className="text-xs text-muted-foreground">
          These describe this simulation, not a published model snapshot.
        </p>
      </DraftCard>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <SnapshotSummaryCard ctx={ctx} datasetId={datasetId} fallbackTitle={datasetTitle} />

          <DraftCard
            title="Model input"
            icon={Layers}
            action={<EditButton step="model" label="model input" onEditStep={onEditStep} />}
          >
            <ModelInputStatus
              modelInputId={local.modelInputId}
              inheritedId={ctx.dataset?.uses.modelInput.id ?? null}
              resolved={modelInput}
            />
          </DraftCard>

          <DraftCard
            title="Run settings"
            icon={SlidersHorizontal}
            action={<EditButton step="run" label="run settings" onEditStep={onEditStep} />}
          >
            <dl className="space-y-1.5 text-sm">
              <SummaryRow label="Run period">
                {parameters.temporal_range_start || "No start date"} → {parameters.temporal_range_end || "No end date"}
              </SummaryRow>
              <SummaryRow label={`Output variables (${parameters.variables.length})`}>
                {parameters.variables.length > 0 ? (
                  <span className="flex flex-wrap gap-1.5">
                    {parameters.variables.map((name) => (
                      <span
                        key={name}
                        className="rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
                      >
                        {name}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-warning">None chosen</span>
                )}
              </SummaryRow>
              {spatial && (
                <SummaryRow label="Spatial subset">
                  <span className="font-mono text-xs">
                    N{spatial.north} S{spatial.south} E{spatial.east} W{spatial.west}
                  </span>
                </SummaryRow>
              )}
              {customCount > 0 && (
                <SummaryRow label="Custom parameters">
                  {customCount} custom parameter{customCount === 1 ? "" : "s"}
                </SummaryRow>
              )}
            </dl>
          </DraftCard>
        </div>

        <div className="min-w-0 space-y-6">
          <DraftCard
            title="Compute"
            icon={Cpu}
            tone="compute"
            action={<EditButton step="run" label="compute" onEditStep={onEditStep} />}
          >
            <dl className="space-y-1.5 text-sm">
              <SummaryRow label="Cluster">Anvil (Purdue)</SummaryRow>
              <SummaryRow label="Cores">
                {compute.cores ?? "Not known"}
                {compute.coresSource === "snapshot" && compute.cores !== null && (
                  <Note>model snapshot&apos;s recommendation</Note>
                )}
                {coresWarning && <Note>{coresWarning}</Note>}
              </SummaryRow>
              <SummaryRow label="Walltime">
                {compute.walltime ? describeSlurmTime(compute.walltime) : "Not known"}
                {compute.walltimeSource === "snapshot" && compute.walltime !== null && (
                  <Note>{automaticWalltimeLabel(compute.walltimeCapped)}</Note>
                )}
              </SummaryRow>
            </dl>
          </DraftCard>

          {problems.length > 0 && <NeedsAttention problems={problems} onEditStep={onEditStep} />}

          {submitCard}
        </div>
      </div>
    </fieldset>
  );
}
