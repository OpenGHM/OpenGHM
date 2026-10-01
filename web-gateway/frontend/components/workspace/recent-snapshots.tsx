import Link from "next/link";
import { Calendar, Grid3X3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Dataset } from "@/lib/repository/types";
import { TagChips } from "@/components/repository/tag-chips";

/**
 * Up to five distinct snapshots the user has already based a simulation on,
 * newest first — the "New Simulation" entry screen's alternative to an
 * empty search box (spec.md's In scope). Each card jumps straight to the
 * configure step, skipping the picker for a snapshot already known.
 */
export function RecentSnapshots({ snapshots }: { snapshots: Dataset[] }) {
  if (snapshots.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {snapshots.map((dataset) => {
        const { start, end } = dataset.simulation.temporalCoverage;
        const { value, unit } = dataset.simulation.resolution;
        return (
          <Link key={dataset.id} href={`/workspace/new/configure?snapshotId=${dataset.id}`} className="block h-full">
            <Card className="h-full gap-0 py-0 transition-all hover:-translate-y-0.5 hover:shadow-md hover:border-primary/40">
              <CardContent className="flex h-full flex-col p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold leading-snug text-foreground">
                    {dataset.about.name}
                  </h3>
                  <TagChips tags={dataset.about.tags} size="sm" className="shrink-0 justify-end" />
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
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
          </Link>
        );
      })}
    </div>
  );
}
