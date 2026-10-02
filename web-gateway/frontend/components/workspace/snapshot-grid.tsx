import { useId, type ReactNode } from "react";
import { History, Loader2, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TimeStamp } from "@/components/common/time-stamp";
import { CARD_SURFACE } from "@/components/repository/catalogue-card";
import { CoverageThumbnail } from "@/components/repository/coverage-thumbnail";
import { TagChips } from "@/components/repository/tag-chips";
import { snapshotBox, snapshotName, snapshotResolution } from "@/components/workspace/snapshot-label";
import { cn } from "@/lib/utils";
import type { Dataset } from "@/lib/repository/types";

/**
 * One model snapshot as a card, the way the Data Repository's grid draws one:
 * the bounding box on a map, then a short name (`snapshotName`), one mono line
 * (resolution, publication date), the official title in two muted lines, and
 * the tag.
 *
 * The whole card selects: the name is a button whose `after` layer covers the
 * card (which is `relative`), so it is the one control and the card shows the
 * focus ring. "Details" is a text button above that layer and opens the sheet
 * without selecting. The official title is the button's description, so a
 * screen reader hears the short name and then which snapshot it is.
 *
 * While its draft is being made `pending` covers the card with a message, and
 * `disabled` (every card, while any one is pending) turns the others off.
 */
function SnapshotCard({
  dataset,
  used,
  pending,
  disabled,
  onSelect,
  onDetails,
}: {
  dataset: Dataset;
  used: boolean;
  pending: boolean;
  disabled: boolean;
  onSelect: (dataset: Dataset) => void;
  onDetails: (dataset: Dataset) => void;
}) {
  const titleId = useId();
  const { about } = dataset;

  return (
    <Card
      className={cn(
        CARD_SURFACE,
        "h-full has-[button[data-select]:focus-visible]:ring-[3px] has-[button[data-select]:focus-visible]:ring-ring/50",
        disabled && !pending && "pointer-events-none opacity-60"
      )}
    >
      <div className="relative h-[150px] shrink-0 border-b bg-muted">
        <CoverageThumbnail
          box={snapshotBox(dataset)}
          aspect="wide"
          className="absolute inset-0 aspect-auto rounded-none border-0"
        />
        {used && (
          <span className="absolute top-3 left-3 z-10 inline-flex items-center gap-1.5 rounded-md bg-card px-2 py-0.5 text-[11.5px] font-medium text-foreground shadow-sm">
            <History aria-hidden="true" className="size-3 text-muted-foreground" />
            Used before
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className="text-base leading-snug font-semibold text-foreground">
          <button
            type="button"
            data-select=""
            disabled={disabled}
            aria-busy={pending ? "true" : undefined}
            aria-describedby={titleId}
            onClick={() => onSelect(dataset)}
            className="text-left outline-none after:absolute after:inset-0 after:content-['']"
          >
            {snapshotName(dataset)}
          </button>
        </h3>
        <p className="font-mono text-xs text-muted-foreground">
          {snapshotResolution(dataset)} · Published <TimeStamp value={dataset.generatedAt} format="date" />
        </p>
        <p
          id={titleId}
          title={about.name}
          className="mt-1 line-clamp-2 text-[13px] leading-snug break-words text-muted-foreground"
        >
          {about.name}
        </p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          <TagChips tags={about.tags} tone="outline" />
          <Button
            type="button"
            variant="link"
            size="sm"
            aria-label={`Details: ${about.name}`}
            onClick={() => onDetails(dataset)}
            className="relative z-10 -mr-2 h-10 shrink-0 px-2 text-muted-foreground hover:text-primary sm:h-8"
          >
            Details
          </Button>
        </div>
      </div>

      {pending && (
        <div
          role="status"
          className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-card/85 text-sm font-medium text-foreground"
        >
          <Loader2 aria-hidden="true" className="size-4 text-primary motion-safe:animate-spin" />
          Creating your draft…
        </div>
      )}
    </Card>
  );
}

/**
 * The model snapshots the Start screen offers, as a grid of cards: three across
 * on a wide screen, one on a phone. The ones the user has already based a
 * simulation on (`usedIds`) come first, in the order they were given, and carry
 * a "Used before" mark; there is no separate list for them.
 */
export function SnapshotGrid({
  datasets,
  usedIds,
  onDetails,
  onSelect,
  pendingId,
  disabled,
  emptyAction,
}: {
  datasets: readonly Dataset[];
  /** Ids of the snapshots the caller has used. */
  usedIds: ReadonlySet<string>;
  /** Details: open the sheet for this snapshot. */
  onDetails: (dataset: Dataset) => void;
  /** The card: start a draft from this snapshot. */
  onSelect: (dataset: Dataset) => void;
  /** The snapshot whose draft is being created, if any. */
  pendingId: string | null;
  /** Every card is off while a draft is being created. */
  disabled: boolean;
  /** Under "No model snapshots found": a way out, such as Reset. */
  emptyAction?: ReactNode;
}) {
  if (datasets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border bg-card px-4 py-16 text-center">
        <SearchX aria-hidden="true" className="mb-3 size-10 text-muted-foreground/40" />
        <h3 className="text-base font-semibold text-foreground">No model snapshots found</h3>
        <p className="mt-1 text-sm text-muted-foreground">Try adjusting your search or filters</p>
        {emptyAction && <div className="mt-3">{emptyAction}</div>}
      </div>
    );
  }

  const ordered = [
    ...datasets.filter((d) => usedIds.has(d.id)),
    ...datasets.filter((d) => !usedIds.has(d.id)),
  ];

  return (
    <ul aria-label="Model snapshots" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {ordered.map((dataset) => (
        <li key={dataset.id} className="min-w-0">
          <SnapshotCard
            dataset={dataset}
            used={usedIds.has(dataset.id)}
            pending={pendingId === dataset.id}
            disabled={disabled}
            onSelect={onSelect}
            onDetails={onDetails}
          />
        </li>
      ))}
    </ul>
  );
}
