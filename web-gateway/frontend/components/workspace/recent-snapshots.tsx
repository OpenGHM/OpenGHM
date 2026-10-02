"use client";

import { Loader2 } from "lucide-react";
import type { Dataset } from "@/lib/repository/types";
import { cn } from "@/lib/utils";

/**
 * Up to five distinct snapshots the user has already based a simulation on,
 * newest first: the Start screen's shortcut past the picker. Each card is a
 * button that hands its snapshot to `onSelect`, which creates the draft at
 * once. A title is clamped to two lines (the whole of it is in `title`), and
 * the cards of a row are as tall as the tallest, with the period and
 * resolution on one line at the foot of each. While one is being created `disabled` turns
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
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                "flex h-full min-h-10 w-full flex-col rounded-xl border bg-card px-4 py-3 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                disabled && !pending ? "cursor-not-allowed opacity-60" : "hover:border-primary/40"
              )}
            >
              <span className="flex items-start justify-between gap-2">
                <span
                  title={dataset.about.name}
                  className="line-clamp-2 min-w-0 break-words text-sm font-medium leading-snug text-foreground"
                >
                  {dataset.about.name}
                </span>
                {pending && (
                  <Loader2
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-primary motion-safe:animate-spin"
                  />
                )}
              </span>
              <span className="mt-auto pt-2 text-xs text-muted-foreground">
                {start} – {end} · {value} {unit}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
