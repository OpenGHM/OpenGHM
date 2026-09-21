import { Ban } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { DeriveSimulationButton } from "@/components/workspace/derive-simulation-button";

/** CANCELLED — distinct from FAILED: a deliberate stop, not an error. */
export function CancelledNoticeCard({
  statusReason,
  datasetId,
}: {
  statusReason: string | null;
  datasetId: string;
}) {
  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-r from-slate-500/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <div className="flex size-8 items-center justify-center rounded-lg bg-slate-500/10">
            <Ban className="size-4 text-slate-600" />
          </div>
          Cancelled
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5 pb-6">
        <p className="text-sm text-muted-foreground">
          {statusReason ?? "This run was cancelled before it finished."} No
          output was produced. Starting over creates a new draft from the same
          snapshot.
        </p>
        <DeriveSimulationButton datasetId={datasetId} />
      </CardContent>
    </Card>
  );
}
