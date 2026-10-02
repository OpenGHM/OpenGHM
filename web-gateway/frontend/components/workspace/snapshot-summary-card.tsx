import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Info, Layers } from "lucide-react";
import { TagChips } from "@/components/repository/tag-chips";
import { DraftCard, SummaryRow } from "@/components/workspace/draft-card";
import type { DraftContext } from "@/lib/workspace/draft-state";

/**
 * The model snapshot a draft starts from, read-only: it cannot be changed once
 * the draft exists. Three states, as `DraftContext.snapshotState` says:
 * - `found`: its name, model and version, coverage and resolution, and a link
 *   to its repository page.
 * - `gone`: it left the repository. The draft keeps the title it was made with,
 *   and cannot be submitted.
 * - `unavailable`: the fetch failed, so nothing is known about it and the
 *   checks that need it are off (the backend still makes them).
 */
export function SnapshotSummaryCard({
  ctx,
  datasetId,
  fallbackTitle,
}: {
  ctx: DraftContext;
  datasetId: string;
  /** The draft's `dataset_title`, for when there is no snapshot to read it from. */
  fallbackTitle: string;
}) {
  const href = `/repository/${encodeURIComponent(datasetId)}`;
  const dataset = ctx.snapshotState === "found" ? ctx.dataset : null;

  if (dataset) {
    const { start, end } = dataset.simulation.temporalCoverage;
    const { value, unit } = dataset.simulation.resolution;
    const { image, version } = dataset.uses.container;
    return (
      <DraftCard
        title="Model snapshot"
        icon={Layers}
        action={
          <Link
            href={href}
            className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary hover:underline sm:min-h-8"
          >
            View in the repository
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        }
      >
        <div className="space-y-1.5">
          <p className="break-words text-sm font-semibold text-foreground">{dataset.about.name}</p>
          <TagChips tags={dataset.about.tags} />
        </div>
        <dl className="space-y-1.5 text-sm">
          <SummaryRow label="Model">
            <span className="font-mono text-xs">
              {image} {version}
            </span>
          </SummaryRow>
          <SummaryRow label="Coverage">
            {start} → {end}
          </SummaryRow>
          <SummaryRow label="Resolution">
            {value} {unit}
          </SummaryRow>
        </dl>
      </DraftCard>
    );
  }

  const gone = ctx.snapshotState === "gone";
  return (
    <DraftCard title="Model snapshot" icon={Layers}>
      <p className="break-words text-sm font-semibold text-foreground">{fallbackTitle}</p>
      {gone ? (
        <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            This model snapshot is no longer in the repository, so this draft can&apos;t be submitted.
          </span>
        </p>
      ) : (
        <>
          <p className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              We couldn&apos;t load this model snapshot, so the checks that need it are off here
              (the period it covers, where a run may start, the recommended compute). Reload the
              page to try again.
            </span>
          </p>
          <Link href={href} className="inline-block text-sm font-medium text-primary hover:underline">
            View in the repository
          </Link>
        </>
      )}
    </DraftCard>
  );
}
