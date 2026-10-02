import Link from "next/link";
import { AlertTriangle, ArrowUpRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { draftField } from "@/components/workspace/draft-field";
import type { ModelInput } from "@/lib/repository/types";
import type { DraftContext } from "@/lib/workspace/draft-state";

const shortId = (id: string) => `${id.slice(0, 12)}…`;

/** The facts about a found snapshot, as the short phrases of one line: model and
 *  version, coverage, resolution. */
export function snapshotFacts(ctx: DraftContext): string[] {
  const dataset = ctx.snapshotState === "found" ? ctx.dataset : null;
  if (!dataset) return [];
  const { start, end } = dataset.simulation.temporalCoverage;
  const { value, unit } = dataset.simulation.resolution;
  const { image, version } = dataset.uses.container;
  return [`${image} ${version}`, `${start} → ${end}`, `${value} ${unit}`];
}

/** The repository page of the snapshot a draft was made from. */
export const snapshotHref = (datasetId: string) => `/repository/${encodeURIComponent(datasetId)}`;

/**
 * What the draft is based on, read-only (a draft's starting point cannot
 * change), as one compact block: the snapshot's title (two lines at most, the
 * whole of it on hover), one line of facts, and a link to its repository page.
 * Three states, as `DraftContext.snapshotState` says:
 * - `found`: the above.
 * - `gone`: it left the repository. The draft keeps the title it was made
 *   with, and cannot be submitted.
 * - `unavailable`: the fetch failed, so nothing is known about it and the checks
 *   that need it are off (the backend still makes them).
 *
 * With `modelInput` the facts end with the model input the run uses, by name
 * when the catalogue has it. A model input the draft carries of its own (only
 * the API can set one: the toolkit has no option for it, so a submit refuses
 * it) is a warning with a way back, `onRevert`; its button is the field the
 * wizard sends focus to for a problem with the model input.
 */
export function DraftBasis({
  ctx,
  datasetId,
  fallbackTitle,
  modelInput,
  disabled = false,
}: {
  ctx: DraftContext;
  datasetId: string;
  /** The draft's `dataset_title`, for when there is no snapshot to read it from. */
  fallbackTitle: string;
  /** Run settings only; Review leaves it out. */
  modelInput?: {
    /** The draft's own override; null inherits the snapshot's. */
    id: string | null;
    /** The catalogue's answer for whichever applies: undefined while looking,
     *  null when it does not hold it. */
    resolved: ModelInput | null | undefined;
    onRevert: () => void;
    /** What the server said about a model input it refused. */
    error?: string;
  };
  disabled?: boolean;
}) {
  const href = snapshotHref(datasetId);
  const dataset = ctx.snapshotState === "found" ? ctx.dataset : null;
  const title = dataset?.about.name ?? fallbackTitle;
  const inheritedId = dataset?.uses.modelInput.id ?? null;
  const chosen = modelInput?.id ?? null;
  const shownId = chosen ?? inheritedId;

  const facts = snapshotFacts(ctx);
  let modelInputText: React.ReactNode = null;
  if (modelInput && chosen === null && shownId !== null) {
    modelInputText =
      modelInput.resolved === undefined ? (
        "Model input: checking…"
      ) : modelInput.resolved ? (
        <>
          Model input:{" "}
          <Link
            href={`/repository/model-inputs/${encodeURIComponent(shownId)}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {modelInput.resolved.about.name}
          </Link>
        </>
      ) : (
        <>
          Model input: <code className="font-mono">{shortId(shownId)}</code>
        </>
      );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <p title={title} className="line-clamp-2 min-w-0 break-words text-sm font-medium text-foreground">
          {title}
        </p>
        {dataset || ctx.snapshotState === "unavailable" ? (
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-1 rounded text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            View in repository
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>

      {(facts.length > 0 || modelInputText) && (
        <p className="break-words text-xs text-muted-foreground">
          {facts.join(" · ")}
          {facts.length > 0 && modelInputText && " · "}
          {modelInputText}
        </p>
      )}

      {ctx.snapshotState === "gone" && (
        <p className="flex items-start gap-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          This model snapshot is no longer in the repository, so this draft can&apos;t be submitted.
        </p>
      )}
      {ctx.snapshotState === "unavailable" && (
        <p className="text-xs text-muted-foreground">
          We couldn&apos;t load this model snapshot, so the checks that need it are off here (the
          period it covers, where a run may start, the recommended compute). Reload the page to try
          again.
        </p>
      )}

      {modelInput && chosen !== null && (
        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex min-w-0 items-start gap-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">
              This draft uses a different model input
              {modelInput.resolved ? `: ${modelInput.resolved.about.name}` : ` (${shortId(chosen)})`}
              . It can&apos;t run yet; revert to the snapshot&apos;s own to submit.
            </span>
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={modelInput.onRevert}
            {...draftField("modelInput")}
            className="min-h-10 shrink-0 sm:min-h-8"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Revert
          </Button>
        </div>
      )}
      {modelInput?.error && <p className="text-xs text-destructive">{modelInput.error}</p>}
    </div>
  );
}
