"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { basisName, snapshotFacts, snapshotHref } from "@/components/workspace/draft-basis";
import { draftField } from "@/components/workspace/draft-field";
import { DraftPanel, DraftSection } from "@/components/workspace/draft-section";
import { DraftStepHeading } from "@/components/workspace/draft-step-heading";
import {
  automaticWalltimeLabel,
  describeCoresBelowRecommendedShort,
  describeSlurmTime,
  effectiveCompute,
  type Recommended,
} from "@/lib/jobs/compute";
import type { DraftContext, DraftField, DraftLocal } from "@/lib/workspace/draft-state";
import type { DraftStep } from "@/lib/workspace/draft-wizard";

/** How many output variables the summary names before "show all". */
const PREVIEW_VARIABLES = 4;

/** One line of the summary: what it is, its value, and the way back to edit it. */
function Row({
  label,
  edit,
  children,
}: {
  label: string;
  edit?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-0.5 py-3 sm:grid-cols-[9rem_1fr_auto] sm:gap-x-6">
      <dt className="text-sm text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd className="order-last col-span-2 min-w-0 break-words text-sm text-foreground sm:order-none sm:col-span-1">
        {children}
      </dd>
      <dd className="col-start-2 row-start-1 sm:col-start-3">{edit}</dd>
    </div>
  );
}

function EditLink({
  step,
  label,
  field,
  onEditStep,
}: {
  step: DraftStep;
  /** What it edits, for its accessible name: "Edit run period". */
  label: string;
  field?: DraftField;
  onEditStep: (step: DraftStep, field?: DraftField) => void;
}) {
  return (
    <Button
      type="button"
      variant="link"
      aria-label={`Edit ${label}`}
      onClick={() => onEditStep(step, field)}
      className="h-auto min-h-10 p-0 text-sm sm:min-h-8"
    >
      Edit
    </Button>
  );
}

/** The output variables as a count, the first few by name, and the rest behind
 *  "show all". */
function VariablesValue({ names }: { names: readonly string[] }) {
  const [all, setAll] = useState(false);
  if (names.length === 0) return <span className="text-warning">None chosen</span>;
  const rest = names.length - PREVIEW_VARIABLES;
  const long = rest > 0;
  return (
    <>
      <span className="font-medium">{names.length} selected</span>
      <span className="text-muted-foreground">
        {" · "}
        {(all || !long ? names : names.slice(0, PREVIEW_VARIABLES)).join(", ")}
        {long && !all && ` and ${rest} more`}
      </span>
      {long && (
        <>
          {" "}
          <button
            type="button"
            aria-expanded={all}
            onClick={() => setAll((v) => !v)}
            className="inline-flex min-h-8 items-center rounded text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {all ? "show fewer" : "show all"}
          </button>
        </>
      )}
    </>
  );
}

/**
 * Step 3, "Review & submit": one list that says what will run, each editable
 * line with a way back to the step that edits it; the name and description;
 * and, last, the submit area (`submitArea`, a `DraftSubmitCard`: it lists what
 * stands in the way, each with a link to fix it, and has the button).
 *
 * Name and description describe this simulation, not a published snapshot, and
 * are the only inputs here. The Name's placeholder is `fallbackName`: what the
 * header and the list call the draft while it has no name. "Based on" has no
 * Edit (a draft's starting point cannot change), only its repository link.
 * `onEditStep` receives the field too so the wizard can focus it.
 */
export function DraftReviewStep({
  datasetId,
  datasetTitle,
  fallbackName,
  ctx,
  local,
  recommended,
  serverErrors,
  onNameChange,
  onDescriptionChange,
  onEditStep,
  submitArea,
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
  serverErrors: Partial<Record<DraftField, string>>;
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string) => void;
  onEditStep: (step: DraftStep, field?: DraftField) => void;
  submitArea: ReactNode;
  /** Everything off, while a submit is under way. */
  disabled?: boolean;
}) {
  const id = useId();
  const { parameters, slurm } = local;
  const compute = effectiveCompute(slurm, recommended);
  const coresWarning = describeCoresBelowRecommendedShort(slurm, recommended);
  const spatial = parameters.spatial_domain;
  const customCount = parameters.custom_params ? Object.keys(parameters.custom_params).length : 0;
  const found = ctx.snapshotState === "found" ? ctx.dataset : null;
  const { name: basedOn, title } = basisName(ctx, datasetTitle);
  const facts = snapshotFacts(ctx);

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-6 border-0 p-0">
      <DraftStepHeading step="review">
        Check what will run, name your simulation, then submit it to Anvil.
      </DraftStepHeading>

      <DraftPanel>
        <DraftSection>
          <dl className="-my-3 divide-y">
            <Row
              label="Based on"
              edit={
                found || ctx.snapshotState === "unavailable" ? (
                  <Link
                    href={snapshotHref(datasetId)}
                    className="inline-flex min-h-10 items-center gap-1 rounded text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8"
                  >
                    View
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                    <span className="sr-only"> {basedOn} in the repository</span>
                  </Link>
                ) : undefined
              }
            >
              <span title={title} className="line-clamp-2 font-medium">
                {basedOn}
              </span>
              {facts.length > 0 && <span className="block text-[13px] text-muted-foreground">{facts.join(" · ")}</span>}
            </Row>
            <Row
              label="Run period"
              edit={<EditLink step="run" field="start" label="run period" onEditStep={onEditStep} />}
            >
              {parameters.temporal_range_start || "No start date"} → {parameters.temporal_range_end || "No end date"}
            </Row>
            <Row
              label="Output variables"
              edit={<EditLink step="run" field="variables" label="output variables" onEditStep={onEditStep} />}
            >
              <VariablesValue names={parameters.variables} />
            </Row>
            <Row
              label="Cores"
              edit={<EditLink step="run" field="cores" label="cores" onEditStep={onEditStep} />}
            >
              {compute.cores ?? "Not known"}
              {compute.coresSource === "snapshot" && compute.cores !== null && (
                <span className="text-muted-foreground"> · recommended</span>
              )}
              {coresWarning && <span className="block text-xs text-warning">{coresWarning}</span>}
            </Row>
            <Row
              label="Walltime"
              edit={<EditLink step="run" field="walltime" label="walltime" onEditStep={onEditStep} />}
            >
              {compute.walltime ? describeSlurmTime(compute.walltime) : "Not known"}
              {compute.walltimeSource === "snapshot" && compute.walltime !== null && (
                <span className="text-muted-foreground"> · {automaticWalltimeLabel(compute.walltimeCapped)}</span>
              )}
            </Row>
            {spatial && (
              <Row
                label="Spatial subset"
                edit={<EditLink step="run" field="spatial" label="spatial subset" onEditStep={onEditStep} />}
              >
                <span className="font-mono text-xs">
                  N{spatial.north} S{spatial.south} E{spatial.east} W{spatial.west}
                </span>
              </Row>
            )}
            {customCount > 0 && (
              <Row
                label="Custom parameters"
                edit={<EditLink step="run" field="custom" label="custom parameters" onEditStep={onEditStep} />}
              >
                {customCount} custom parameter{customCount === 1 ? "" : "s"}
              </Row>
            )}
          </dl>
        </DraftSection>

        <DraftSection title="Name and description">
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
              Description
            </Label>
            <textarea
              id={`${id}-description`}
              value={local.description}
              rows={3}
              placeholder="What is this simulation for?"
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

        {submitArea}
      </DraftPanel>
    </fieldset>
  );
}
