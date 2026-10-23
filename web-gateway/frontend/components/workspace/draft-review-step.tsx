"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClampedName } from "@/components/common/clamped-name";
import { basisTitle, snapshotHref } from "@/components/workspace/draft-basis";
import { describeOutput, snapshotOutput } from "@/components/workspace/output-choice-field";
import { snapshotFacts } from "@/components/workspace/snapshot-facts";
import { DraftPanel, DraftSection } from "@/components/workspace/draft-section";
import { DraftStepHeading } from "@/components/workspace/draft-step-heading";
import { PublishedAnswerCard, PublishedAnswerNotice } from "@/components/workspace/published-answer-card";
import {
  describeCoresBelowRecommendedShort,
  describeDuration,
  effectiveCompute,
  estimatedRunLabel,
  estimatedRunSeconds,
  postProcessingShare,
  runsClimatology,
  type Recommended,
} from "@/lib/jobs/compute";
import { cn } from "@/lib/utils";
import { dateMessages } from "@/lib/workspace/draft-checks";
import { describeChanges } from "@/lib/workspace/model-parameters";
import type { DraftChecksState } from "@/lib/workspace/use-draft-checks";
import type { ModelParametersState } from "@/lib/workspace/use-model-parameters";
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
  mono = false,
  children,
}: {
  label: string;
  edit?: ReactNode;
  /** A value that is a date or a number: set in mono. */
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-start gap-x-4 gap-y-0.5 py-3 sm:grid-cols-[9rem_1fr_auto] sm:gap-x-6">
      <dt className="text-sm text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd
        className={cn(
          "order-last col-span-2 min-w-0 break-words text-sm text-foreground sm:order-none sm:col-span-1",
          mono && "font-mono text-[13px]"
        )}
      >
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

/** What the checks of the run say that the summary does not: still being asked, the
 *  warnings and notes, or that they could not be asked. The errors are not here: the submit
 *  card lists them, each with a way to fix it. */
function CheckNotes({ checks }: { checks: DraftChecksState }) {
  if (checks.status === "loading") {
    return (
      <p role="status" className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
        <Loader2 className="mt-0.5 size-3.5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
        Checking that the datasets cover the run…
      </p>
    );
  }
  if (checks.status === "error") {
    return (
      <p role="status" className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        We couldn&apos;t check the run against its datasets. You can still submit it; the submit checks it too.
      </p>
    );
  }
  if (checks.status !== "ready" || checks.warnings.length === 0) return null;
  return (
    <DraftSection title="Heads up">
      <ul className="space-y-2">
        {checks.warnings.map((note) => (
          <li
            key={note.rule}
            className={cn(
              "flex items-start gap-2 text-sm",
              note.level === "info" ? "text-muted-foreground" : "text-warning"
            )}
          >
            {note.level === "info" ? (
              <Info className="mt-1 size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle className="mt-1 size-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0 break-words">{note.message}</span>
          </li>
        ))}
      </ul>
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
 *
 * `checks` is what the rules of the parameter tree say about the draft (`useDraftChecks`).
 * The errors are the submit card's to list (it has a Fix link for each, and its button is off);
 * the run period row also says the ones about a date, under the dates. The warnings and notes
 * are a "Heads up" card, and a check still being asked or that failed is one line.
 */
export function DraftReviewStep({
  datasetId,
  datasetTitle,
  ctx,
  local,
  recommended,
  onEditStep,
  submitArea,
  publishedAnswer = { status: "none" },
  checks = { status: "none" },
  modelParameters,
  disabled = false,
}: {
  datasetId: string;
  datasetTitle: string;
  ctx: DraftContext;
  local: DraftLocal;
  recommended: Recommended | null;
  onEditStep: (step: DraftStep, field?: DraftField) => void;
  submitArea: ReactNode;
  publishedAnswer?: PublishedAnswerState;
  /** The rules of the parameter tree the draft fails, for the notes and the date errors. */
  checks?: DraftChecksState;
  /** The snapshot's parameter tree, for the names of the changed parameters;
   *  without it a change is listed by its key. */
  modelParameters?: ModelParametersState;
  /** Everything off, while a submit is under way. */
  disabled?: boolean;
}) {
  const { parameters, slurm } = local;
  const postProcessing = runsClimatology(parameters.post_processing, ctx.dataset?.postProcessing);
  const compute = effectiveCompute(slurm, recommended, postProcessing);
  const estimate = estimatedRunSeconds(recommended, postProcessing);
  const coresWarning = describeCoresBelowRecommendedShort(slurm, recommended);
  const spatial = parameters.spatial_domain;
  const changes = describeChanges(
    parameters.custom_params,
    modelParameters?.status === "ready" ? modelParameters.tree : null
  );
  const found = ctx.snapshotState === "found" ? ctx.dataset : null;
  const title = basisTitle(ctx, datasetTitle);
  const facts = found ? snapshotFacts(found) : [];
  const name = local.name.trim();
  const description = local.description.trim();
  const dateErrors = dateMessages(checks.status === "ready" ? checks.errors : []);

  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-4 border-0 p-0">
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
                <ClampedName lines={3} className="font-medium">
                  {name}
                </ClampedName>
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
              <ClampedName lines={2} className="font-medium">
                {title}
              </ClampedName>
              {facts.length > 0 && <span className="block text-[13px] text-muted-foreground">{facts.join(" · ")}</span>}
            </Row>
            <Row
              mono
              label="Run period"
              edit={<EditLink step="run" field="start" label="run period" onEditStep={onEditStep} />}
            >
              {parameters.temporal_range_start || "No start date"} → {parameters.temporal_range_end || "No end date"}
              {Array.from(new Set([dateErrors.start, dateErrors.end])).map(
                (text) =>
                  text && (
                    <span key={text} className="mt-1 block font-sans text-[13px] text-destructive">
                      {text}
                    </span>
                  )
              )}
            </Row>
            <Row
              label="Output variables"
              edit={<EditLink step="run" field="variables" label="output variables" onEditStep={onEditStep} />}
            >
              <VariablesValue names={parameters.variables} />
            </Row>
            <Row
              label="Post-processing"
              edit={<EditLink step="run" field="postProcessing" label="post-processing" onEditStep={onEditStep} />}
            >
              {describeOutput(parameters.post_processing ?? snapshotOutput(ctx.dataset))}
            </Row>
            <Row
              mono
              label="Cores"
              edit={<EditLink step="run" field="cores" label="cores" onEditStep={onEditStep} />}
            >
              {compute.cores ?? "Not known"}
              {compute.coresSource === "snapshot" && compute.cores !== null && (
                <span className="text-muted-foreground"> · recommended</span>
              )}
              {coresWarning && <span className="block text-xs text-warning">{coresWarning}</span>}
            </Row>
            <Row mono label="Estimated run time">
              {estimate !== null ? describeDuration(estimate) : "Not known"}
              {estimate !== null && (
                <span className="text-muted-foreground">
                  {" "}
                  · {estimatedRunLabel(postProcessingShare(recommended, postProcessing) > 0)}
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
            {changes.length > 0 && (
              <Row
                label="Model parameters"
                edit={<EditLink step="run" field="custom" label="model parameters" onEditStep={onEditStep} />}
              >
                <span className="font-medium">
                  {changes.length} changed
                </span>
                <ul className="mt-1 space-y-1">
                  {changes.map((change) => (
                    <li key={`${change.kind}:${change.path}`} className="min-w-0 text-[13px]">
                      {change.label && <span className="mr-1.5">{change.label}</span>}
                      {change.kind === "switched_on" ? (
                        <>
                          <code className="font-mono text-xs break-all text-muted-foreground">{change.path}</code>
                          <span className="text-muted-foreground"> · {change.shown}</span>
                        </>
                      ) : (
                        <>
                          <code className="font-mono text-xs break-all text-muted-foreground">
                            {change.path} = {change.value === "" ? "''" : change.value}
                          </code>
                          {change.shown !== change.value && (
                            <span className="text-muted-foreground"> · {change.shown}</span>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </Row>
            )}
          </dl>
        </DraftSection>

        <CheckNotes checks={checks} />

        {publishedAnswer.status === "loading" && <AnswerSkeleton />}
        {publishedAnswer.status === "error" && (
          <p
            role="status"
            className="flex items-start gap-2 px-1 text-xs text-muted-foreground"
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
