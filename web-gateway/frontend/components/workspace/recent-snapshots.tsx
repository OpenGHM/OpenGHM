"use client";

import { Calendar, Grid3X3, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Dataset } from "@/lib/repository/types";
import { TagChips } from "@/components/repository/tag-chips";
import { cn } from "@/lib/utils";

/**
 * Up to five distinct snapshots the user has already based a simulation on,
 * newest first: the Start screen's shortcut past the picker. Each card is a
 * button that hands its snapshot to `onSelect`, which creates the draft at
 * once. A title is clamped to two lines (the whole of it is in `title`), and
 * the cards of a row are as tall as the tallest, with the period and
 * resolution at the foot of each. While one is being created `disabled` turns
 * every card off and `pendingId` puts a spinner on the one that was clicked.
 */
export function RecentSnapshots({
  snapshots,
  onSelect,
  pendingId = null,
  disabled = false,
}: {
  snapshots: Dataset[];
  onSelect: (dataset: Dataset) => void;
  /** The snapshot whose draft is being created, if any. */
  pendingId?: string | null;
  disabled?: boolean;
}) {
  if (snapshots.length === 0) return null;

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {snapshots.map((dataset) => {
        const { start, end } = dataset.simulation.temporalCoverage;
        const { value, unit } = dataset.simulation.resolution;
        const pending = pendingId === dataset.id;
        return (
          <li key={dataset.id}>
            <button
              type="button"
              disabled={disabled}
              aria-busy={pending ? "true" : undefined}
              aria-label={`Start from ${dataset.about.name}`}
              onClick={() => onSelect(dataset)}
              className={cn(
                "block h-full min-h-10 w-full rounded-xl text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                disabled && !pending && "cursor-not-allowed opacity-60"
              )}
            >
              <Card
                className={cn(
                  "h-full gap-0 py-0 transition-all",
                  !disabled && "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                )}
              >
                <CardContent className="flex h-full flex-col p-4">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <h3
                      title={dataset.about.name}
                      className="line-clamp-2 min-w-0 break-words text-sm font-semibold leading-snug text-foreground"
                    >
                      {dataset.about.name}
                    </h3>
                    {pending ? (
                      <Loader2
                        aria-hidden="true"
                        className="size-4 shrink-0 text-primary motion-safe:animate-spin"
                      />
                    ) : (
                      <TagChips tags={dataset.about.tags} size="sm" className="shrink-0 justify-end" />
                    )}
                  </div>
                  <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="size-3" />
                      {start} – {end}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Grid3X3 className="size-3" />
                      {value} {unit}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
