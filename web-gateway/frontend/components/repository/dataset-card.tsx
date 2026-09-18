import Link from "next/link";
import { Dataset } from "@/lib/repository/types";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar, Grid3X3 } from "lucide-react";

export function DatasetCard({ dataset }: { dataset: Dataset }) {
  const { start, end } = dataset.simulation.temporalCoverage;
  const { value, unit } = dataset.simulation.resolution;

  return (
    <Link href={`/repository/${dataset.id}`} className="block">
      <Card className="gap-0 py-0 transition-all hover:shadow-md hover:-translate-y-0.5">
        <CardContent className="p-5">
          <div className="mb-2 flex items-start justify-between gap-3">
            <h3 className="text-base font-semibold leading-snug text-foreground">
              {dataset.about.name}
            </h3>
            <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              {dataset.about.category}
            </span>
          </div>

          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Calendar className="size-3.5" />
              {start} – {end}
            </span>
            <span className="inline-flex items-center gap-1">
              <Grid3X3 className="size-3.5" />
              {value} {unit}
            </span>
          </div>

          <p className="line-clamp-2 text-sm text-muted-foreground leading-relaxed">
            {dataset.about.description}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
