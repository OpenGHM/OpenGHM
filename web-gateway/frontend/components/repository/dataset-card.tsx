import Link from "next/link";
import { Dataset } from "@/lib/repository/types";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar, Grid3X3, FileType, HardDrive } from "lucide-react";

const DATASET_TYPE_COLORS: Record<string, string> = {
  snapshot: "bg-green-100 text-green-700",
  raw_data: "bg-amber-100 text-amber-700",
};

const DATASET_TYPE_LABELS: Record<string, string> = {
  snapshot: "Model Snapshot",
  raw_data: "Model Inputs",
};

export function DatasetCard({ dataset }: { dataset: Dataset }) {
  const typeColor =
    DATASET_TYPE_COLORS[dataset.datasetType] || "bg-muted text-muted-foreground";
  const typeLabel = DATASET_TYPE_LABELS[dataset.datasetType] || dataset.datasetType;

  return (
    <Link href={`/repository/${dataset.id}`} className="block">
      <Card className="gap-0 py-0 transition-all hover:shadow-md hover:-translate-y-0.5">
        <CardContent className="p-5">
          <div className="mb-2 flex items-start justify-between gap-3">
            <h3 className="text-base font-semibold leading-snug text-foreground">
              {dataset.title}
            </h3>
            <span
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${typeColor}`}
            >
              {typeLabel}
            </span>
          </div>

          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Calendar className="size-3.5" />
              {dataset.temporalCoverage === "static" ? "Static" : dataset.temporalCoverage}
            </span>
            <span className="inline-flex items-center gap-1">
              <Grid3X3 className="size-3.5" />
              {dataset.spatialResolution}
            </span>
            <span className="inline-flex items-center gap-1">
              <FileType className="size-3.5" />
              {dataset.format}
            </span>
            <span className="inline-flex items-center gap-1">
              <HardDrive className="size-3.5" />
              {dataset.fileSize}
            </span>
          </div>

          <p className="line-clamp-2 text-sm text-muted-foreground leading-relaxed">
            {dataset.description}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
