import { cn } from "@/lib/utils";
import { kindLabel } from "@/lib/repository/catalogue-format";
import type { CatalogueItem } from "@/lib/repository/types";

/** "Model Snapshot" or "Model Input": a quiet outlined label, with a dot in the kind's hue (brand, compute). */
export function KindBadge({ kind }: { kind: CatalogueItem["kind"] }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground"
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full", kind === "snapshot" ? "bg-primary" : "bg-compute")}
      />
      {kindLabel(kind)}
    </span>
  );
}
