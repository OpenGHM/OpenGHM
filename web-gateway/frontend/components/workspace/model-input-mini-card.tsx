import { CheckCircle2, Database, Waves } from "lucide-react";
import { TagChips } from "@/components/repository/tag-chips";
import { Card, CardContent } from "@/components/ui/card";
import type { ModelInput } from "@/lib/repository/types";

/**
 * A model input in a list. With `onSelect` it is a button; without, it is
 * plain text, because a control that can only ever be disabled is not worth a
 * tab stop (choosing a model input cannot run yet, ADR 0025).
 *
 * Copied from the old wizard's private `ModelInputMiniCard`
 * (`wizard-model-input-step.tsx`, `model-input-section.tsx`), which the
 * cleanup slice deletes; this is the one shared card.
 */
export function ModelInputMiniCard({
  modelInput,
  selected = false,
  selectedLabel = "Selected",
  onSelect,
}: {
  modelInput: ModelInput;
  selected?: boolean;
  /** What a selected card says it is, beside the check mark. */
  selectedLabel?: string;
  onSelect?: () => void;
}) {
  const datasetCount = modelInput.datasets.length;
  const networkCount = modelInput.networks?.length ?? 0;

  const card = (
    <Card
      className={`h-full gap-0 py-0 transition-all ${
        selected ? "border-primary ring-2 ring-primary/30" : ""
      } ${onSelect ? "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md" : ""}`}
    >
      <CardContent className="p-4">
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <h4 className="min-w-0 break-words text-sm font-semibold leading-snug text-foreground">
            {modelInput.about.name}
          </h4>
          <TagChips tags={modelInput.about.tags} tone="primary" size="sm" className="shrink-0 justify-end" />
        </div>
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Database className="size-3" aria-hidden="true" />
            {datasetCount} dataset{datasetCount !== 1 ? "s" : ""}
          </span>
          {networkCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Waves className="size-3" aria-hidden="true" />
              {networkCount} network{networkCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {modelInput.about.description}
        </p>
        {selected && (
          <p className="mt-2 flex items-center gap-1 text-xs font-medium text-primary">
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            {selectedLabel}
          </p>
        )}
      </CardContent>
    </Card>
  );

  return onSelect ? (
    <button type="button" onClick={onSelect} className="block h-full w-full text-left">
      {card}
    </button>
  ) : (
    <div className="h-full">{card}</div>
  );
}
