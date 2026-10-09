import { cn } from "@/lib/utils";
import { kindLabel } from "@/lib/repository/catalogue-format";
import type { CatalogueItem } from "@/lib/repository/types";

/** "Model Snapshot" or "Model Input": a pill tinted in the kind's hue (brand for a snapshot, compute for an input). */
export function KindBadge({ kind }: { kind: CatalogueItem["kind"] }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        kind === "snapshot" ? "bg-secondary text-secondary-foreground" : "bg-compute/10 text-compute"
      )}
    >
      {kindLabel(kind)}
    </span>
  );
}
