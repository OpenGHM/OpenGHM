"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { basisFullTitle, basisTitle, snapshotHref } from "@/components/workspace/draft-basis";
import { describeOutput, snapshotOutput } from "@/components/workspace/output-choice-field";
import { snapshotFacts } from "@/components/workspace/snapshot-facts";
import { DraftPanel, DraftSection } from "@/components/workspace/draft-section";
import { DraftStepHeading } from "@/components/workspace/draft-step-heading";
import { PublishedAnswerCard, PublishedAnswerNotice } from "@/components/workspace/published-answer-card";
import {
  automaticWalltimeLabel,
  describeCoresBelowRecommendedShort,
  describeSlurmTime,
  effectiveCompute,
  runsClimatology,
  type Recommended,
} from "@/lib/jobs/compute";
import type { PublishedAnswerState } from "@/lib/workspace/use-published-answer";
import type { DraftContext, DraftField, DraftLocal } from "@/lib/workspace/draft-state";
import type { DraftStep } from "@/lib/workspace/draft-wizard";

/** How many output variables the summary names before "show all". */
const PREVIEW_VARIABLES = 4;

/** Under "Not named yet": a nudge, not a rule (`submitProblems` has none for the
 *  name). Without one the draft is called by the name the header and the list
 *  generate for it, which says nothing about what it is. */
export const NAME_NUDGE = "Add a name so you can find this snapshot draft later.";

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

/** While the published results are being looked up: the shape of the card that
 *  will replace it, in the place of the submit area. Submitting waits for it, so
 *  a draft that is answered is never offered for submission first. */
function AnswerSkeleton() {
  return (
    <DraftSection title="Published results">
      <div role="status" aria-busy="true" className="space-y-3">
        <span className="sr-only">Checking whether this is already published…</span>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </DraftSection>
  );
}

/**
 * Step 3, "Review & submit": one list that says what will run, each line with
 * a way back to the step that edits it, and, last, the submit area
 * (`submitArea`, a `DraftSubmitCard`: it lists what stands in the way, each
 * with a link to fix it, and has the button).
 *
 * Nothing is edited here. The name and the description are entered on Run
 * settings, and show as rows whose Edit sends focus to them; an unnamed draft
 * reads "Not named yet", with a muted line under it that says why a name helps
 * (`NAME_NUDGE`; its Edit is the way to give one), and still submits (it keeps
 * the name the header and the list give it). "Based on" has no Edit (a draft's starting point cannot
 * change), only its repository link. `onEditStep` receives the field too so the
 * wizard can focus it.
 *
 * `publishedAnswer` is what the wizard learned about the snapshot's published
 * results for this draft (`usePublishedAnswer`). Answered: a warning notice comes first, the panel ends with
 * the summary, the published results card follows it, and `submitArea` (then the
 * secondary "Run anyway") goes under the card. Loading: a skeleton in place of
 * the submit area. Otherwise `submitArea` ends the panel as ever, with a note
 * above it when the check itself failed.
 */
export function DraftReviewStep({
  datasetId,
  datasetTitle,
  datasetShortTitle,
  ctx,
  local,
  recommended,
  onEditStep,
  submitArea,
  publishedAnswer = { status: "none" },
  disabled = false,
}: {
  datasetId: string;
  datasetTitle: string;
  /** The draft's `dataset_short_title`, if it has one. */
  datasetShortTitle?: string | null;
  ctx: DraftContext;
  local: DraftLocal;
  recommended: Recommended | null;
  onEditStep: (step: DraftStep, field?: DraftField) => void;
  submitArea: ReactNode;
  publishedAnswer?: PublishedAnswerState;
  /** Everything off, while a submit is under way. */
  disabled?: boolean;
}) {
  const { parameters, slurm } = local;
  const compute = effectiveCompute(
    slurm,
    recommended,
    runsClimatology(parameters.post_processing, ctx.dataset?.postProcessing)
  );
  const coresWarning = describeCoresBelowRecommendedShort(slurm, recommended);
  const spatial = parameters.spatial_domain;
  const customCount = parameters.custom_params ? Object.keys(parameters.custom_params).length : 0;
  const found = ctx.snapshotState === "found" ? ctx.dataset : null;
  const title = basisTitle(ctx, datasetTitle, datasetShortTitle);
  const fullTitle = basisFullTitle(ctx, datasetTitle);
  const facts = found ? snapshotFacts(found) : [];
  const name = local.name.trim();
  const description = local.description.trim();

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-6 border-0 p-0">
      <DraftStepHeading step="review">
        {publishedAnswer.status === "answered"
          ? "Check what you asked for, then download the published results."
          : "Check what will run, then submit it to Anvil."}
      </DraftStepHeading>

      {publishedAnswer.status === "answered" && <PublishedAnswerNotice />}

      <DraftPanel>
        <DraftSection>
          <dl className="-my-3 divide-y">
            <Row label="Name" edit={<EditLink step="run" field="name" label="name" onEditStep={onEditStep} />}>
              {name ? (
                <span className="font-medium">{name}</span>
              ) : (
                <>
                  <span className="text-muted-foreground">Not named yet</span>
                  <span className="block text-[13px] text-muted-foreground">{NAME_NUDGE}</span>
                </>
              )}
            </Row>
            {description && (
              <Row
                label="Description"
                edit={<EditLink step="run" field="description" label="description" onEditStep={onEditStep} />}
              >
                <span className="line-clamp-3 whitespace-pre-line">{description}</span>
              </Row>
            )}
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
                    <span className="sr-only"> {title} in the repository</span>
                  </Link>
                ) : undefined
              }
            >
              <span title={fullTitle} className="line-clamp-2 font-medium break-words">
                {title}
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
              label="Output"
              edit={<EditLink step="run" field="postProcessing" label="output" onEditStep={onEditStep} />}
            >
              {describeOutput(parameters.post_processing ?? snapshotOutput(ctx.dataset))}
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
                <span className="text-muted-foreground">
                  {" "}
                  · {automaticWalltimeLabel(compute.walltimeCapped, "summary", compute.includesPostProcessing)}
                </span>
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

        {publishedAnswer.status === "loading" && <AnswerSkeleton />}
        {publishedAnswer.status === "error" && (
          <p
            role="status"
            className="flex items-start gap-2 px-5 py-3 text-xs text-muted-foreground sm:px-7"
          >
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            We couldn&apos;t check whether this is already published. You can still submit it.
          </p>
        )}
        {publishedAnswer.status !== "loading" && publishedAnswer.status !== "answered" && submitArea}
      </DraftPanel>

      {publishedAnswer.status === "answered" && (
        <>
          <PublishedAnswerCard
            answer={publishedAnswer.answer}
            draftStart={parameters.temporal_range_start}
          />
          {submitArea}
        </>
      )}
    </fieldset>
  );
}
