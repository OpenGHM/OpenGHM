import Link from "next/link";
import { AlertTriangle, ArrowUpRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CoverageThumbnail } from "@/components/repository/coverage-thumbnail";
import { draftField } from "@/components/workspace/draft-field";
import { snapshotBox, snapshotFacts } from "@/components/workspace/snapshot-facts";
import { ClampedName, clampClass } from "@/components/common/clamped-name";
import { cn } from "@/lib/utils";
import type { ModelInput } from "@/lib/repository/types";
import type { DraftContext } from "@/lib/workspace/draft-state";

const shortId = (id: string) => `${id.slice(0, 12)}…`;

/** The title of the snapshot a draft is based on, whole: the snapshot's own
 *  (`about.name`) when it was found, else the title the draft was made with. */
export function basisTitle(ctx: DraftContext, fallbackTitle: string): string {
  return ctx.snapshotState === "found" && ctx.dataset ? ctx.dataset.about.name : fallbackTitle;
}

/** The repository page of the snapshot a draft was made from. */
export const snapshotHref = (datasetId: string) => `/repository/${encodeURIComponent(datasetId)}`;

/**
 * What the draft is based on, read-only (a draft's starting point cannot
 * change), as a small card at the top of Run settings, the one that overlaps the
 * band: the snapshot's map thumbnail, its title (two lines at most, the whole
 * title on hover), one muted line of facts (model and version, years,
 * resolution), and a button to its repository page. Three states, as
 * `DraftContext.snapshotState` says:
 * - `found`: the above.
 * - `gone`: it left the repository. The draft keeps the title it was made
 *   with, and cannot be submitted.
 * - `unavailable`: the fetch failed, so nothing is known about it and the checks
 *   that need it are off (the backend still makes them).
 *
 * With `modelInput` the facts end with the model input the simulation uses, by name
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
  action,
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
  /** What goes after the repository link: Run settings puts its Help button here. */
  action?: React.ReactNode;
  disabled?: boolean;
}) {
  const href = snapshotHref(datasetId);
  const dataset = ctx.snapshotState === "found" ? ctx.dataset : null;
  const title = basisTitle(ctx, fallbackTitle);
  const inheritedId = dataset?.uses.modelInput.id ?? null;
  const chosen = modelInput?.id ?? null;
  const shownId = chosen ?? inheritedId;

  const facts = dataset ? snapshotFacts(dataset) : [];
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
            title={modelInput.resolved.about.name}
            className="font-medium text-primary underline-offset-2 hover:underline"
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
    <div className="space-y-3 rounded-card bg-card p-4 shadow-raised sm:px-6 sm:py-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3.5">
        {dataset && (
          <div className="relative aspect-[2/1] w-[120px] shrink-0 overflow-hidden rounded-[10px] border-[1.5px] border-data-1 bg-secondary">
            <CoverageThumbnail
              box={snapshotBox(dataset)}
              aspect="wide"
              showLabel={false}
              className="absolute inset-0 aspect-auto rounded-none border-0"
            />
          </div>
        )}
        <div className="min-w-[min(100%,17.5rem)] max-w-full flex-1 space-y-1">
          <p className="font-mono text-[11.5px] tracking-[0.06em] text-primary uppercase">Based on</p>
          <ClampedName as="p" lines={2} className="text-base leading-snug font-[650] tracking-[-0.01em] text-foreground">
            {title}
          </ClampedName>
          {(facts.length > 0 || modelInputText) && (
            <p className={cn(clampClass(2), "text-[13px] text-muted-foreground")}>
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
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {dataset || ctx.snapshotState === "unavailable" ? (
            <Link
              href={href}
              className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-[10px] bg-muted px-3.5 text-[13.5px] font-semibold text-foreground outline-none transition-colors hover:bg-secondary hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              View in repository
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          ) : null}
          {action}
        </div>
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
          period it covers, where a simulation may start, the recommended compute). Reload the page to try
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
