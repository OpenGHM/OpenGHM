import { AlertOctagon } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { DeriveSimulationButton } from "@/components/workspace/derive-simulation-button";

/**
 * FAILED — the error, and what happens next. A failed simulation can't be
 * edited in place (PATCH /jobs/{id} is refused past DRAFT), so "edit and
 * resubmit" is honestly a *new* draft from the same snapshot rather than a
 * reopened editor on this one.
 */
export function FailedNextStepsCard({
  statusReason,
  datasetId,
}: {
  statusReason: string | null;
  datasetId: string;
}) {
  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-r from-red-500/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <div className="flex size-8 items-center justify-center rounded-lg bg-red-500/10">
            <AlertOctagon className="size-4 text-red-600" />
          </div>
          What now
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5 pb-6">
        <p className="text-sm text-muted-foreground">
          {statusReason ?? "The run failed."} A failed simulation can&apos;t be
          edited in place — parameters are only editable while a simulation is
          a draft. Starting over creates a new draft from the same snapshot;
          the full stderr below is worth reading first.
        </p>
        <DeriveSimulationButton datasetId={datasetId} />
      </CardContent>
    </Card>
  );
}
