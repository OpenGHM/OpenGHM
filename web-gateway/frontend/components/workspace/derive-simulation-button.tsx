import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { newStepHref } from "@/lib/workspace/draft-wizard";

/** The outline button the detail page's cards use (also `DuplicateSimulationButton`). */
export const CARD_BUTTON =
  "h-auto min-h-10 gap-2 whitespace-normal border-primary px-6 text-left text-base font-semibold text-primary hover:bg-primary/5";

/**
 * "New simulation from this snapshot" (T9). Opens the new-simulation wizard on
 * Run settings, starting from the snapshot. Nothing is created here: the
 * simulation is stored when the person saves it (ADR 0028).
 */
export function DeriveSimulationButton({
  datasetId,
  label = "New simulation from this model snapshot",
  fullWidth = false,
}: {
  datasetId: string;
  label?: string;
  /** Fill the card it sits in (the detail page's cards). */
  fullWidth?: boolean;
}) {
  return (
    <div className={`flex max-w-full flex-col gap-1.5 ${fullWidth ? "items-stretch" : "items-end"}`}>
      <Button asChild size="lg" variant="outline" className={CARD_BUTTON}>
        <Link href={newStepHref(datasetId, "run")}>
          <FlaskConical className="size-5" aria-hidden="true" />
          {label}
        </Link>
      </Button>
    </div>
  );
}
