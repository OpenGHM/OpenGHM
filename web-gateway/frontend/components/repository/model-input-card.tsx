import Link from "next/link";
import { ModelInput } from "@/lib/repository/types";
import { Card, CardContent } from "@/components/ui/card";
import { Database, Waves } from "lucide-react";

export function ModelInputCard({ modelInput }: { modelInput: ModelInput }) {
  const datasetCount = modelInput.datasets.length;
  const networkCount = modelInput.networks?.length ?? 0;

  return (
    <Link href={`/repository/model-inputs/${modelInput.id}`} className="block">
      <Card className="gap-0 py-0 transition-all hover:shadow-md hover:-translate-y-0.5">
        <CardContent className="p-5">
          <div className="mb-2 flex items-start justify-between gap-3">
            <h3 className="text-base font-semibold leading-snug text-foreground">
              {modelInput.about.name}
            </h3>
            <span className="shrink-0 rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-medium text-teal-700">
              {modelInput.about.category}
            </span>
          </div>

          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Database className="size-3.5" />
              {datasetCount} dataset{datasetCount !== 1 ? "s" : ""}
            </span>
            {networkCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Waves className="size-3.5" />
                {networkCount} network{networkCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          <p className="line-clamp-2 text-sm text-muted-foreground leading-relaxed">
            {modelInput.about.description}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
