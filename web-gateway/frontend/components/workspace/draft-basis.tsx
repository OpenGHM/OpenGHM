import Link from "next/link";
import { AlertTriangle, ArrowUpRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CoverageThumbnail } from "@/components/repository/coverage-thumbnail";
import { draftField } from "@/components/workspace/draft-field";
import {
  snapshotBox,
  snapshotExtent,
  snapshotName,
  snapshotResolution,
} from "@/components/workspace/snapshot-label";
import type { ModelInput } from "@/lib/repository/types";
import type { DraftContext } from "@/lib/workspace/draft-state";

const shortId = (id: string) => `${id.slice(0, 12)}…`;

/** What to call the snapshot a draft is based on, and the whole title behind
 *  it: the short name (`snapshotName`) and the official title when the
 *  snapshot was found; the title the draft was made with, alone, when not. */
export function basisName(
  ctx: DraftContext,
  fallbackTitle: string
): { name: string; title: string } {
  const dataset = ctx.snapshotState === "found" ? ctx.dataset : null;
  return dataset
    ? { name: snapshotName(dataset), title: dataset.about.name }
    : { name: fallbackTitle, title: fallbackTitle };
}

/** The facts about a found snapshot, as the short phrases of one muted line:
 *  how far it reaches (Global or Regional), model and version, resolution. */
export function snapshotFacts(ctx: DraftContext): string[] {
  const dataset = ctx.snapshotState === "found" ? ctx.dataset : null;
  if (!dataset) return [];
  const { image, version } = dataset.uses.container;
  return [snapshotExtent(dataset), `${image} ${version}`, snapshotResolution(dataset)];
}

/** The repository page of the snapshot a draft was made from. */
export const snapshotHref = (datasetId: string) => `/repository/${encodeURIComponent(datasetId)}`;

/**
 * What the draft is based on, read-only (a draft's starting point cannot
 * change), as a small card at the top of Run settings: the snapshot's map
 * thumbnail, its short name (`snapshotName`; the official title is on hover),
 * one muted line of facts, and a link to its repository page. Three states, as
 * `DraftContext.snapshotState` says:
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
  const { name, title } = basisName(ctx, fallbackTitle);
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
    <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {dataset && (
            <div className="relative h-12 w-24 shrink-0 overflow-hidden rounded-lg border bg-muted">
              <CoverageThumbnail
                box={snapshotBox(dataset)}
                aspect="wide"
                showLabel={false}
                className="absolute inset-0 aspect-auto rounded-none border-0"
              />
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Based on</p>
            <p title={title} className="truncate text-base font-semibold text-foreground">
              {name}
            </p>
            {(facts.length > 0 || modelInputText) && (
              <p className="text-[13px] break-words text-muted-foreground">
                {facts.map((fact, i) => (
                  <span key={fact}>
                    {i > 0 && " · "}
                    <span className="whitespace-nowrap">{fact}</span>
                  </span>
                ))}
                {facts.length > 0 && modelInputText && " · "}
                {modelInputText}
              </p>
            )}
          </div>
        </div>
        {dataset || ctx.snapshotState === "unavailable" ? (
          <Link
            href={href}
            className="inline-flex min-h-10 shrink-0 items-center gap-1 self-start rounded text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8 sm:self-center"
          >
            View in repository
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        ) : null}
      </div>

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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
