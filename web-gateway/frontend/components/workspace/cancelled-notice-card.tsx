import { Ban } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { DeriveSimulationButton } from "@/components/workspace/derive-simulation-button";
import { ExcerptBlock } from "@/components/workspace/excerpt-block";
import { RunMetadata } from "@/components/workspace/run-metadata";
import { TimeStamp } from "@/components/workspace/time-stamp";
import { HUE } from "@/lib/jobs/status-hue";
import type { Job } from "@/lib/jobs/types";
import { cancelledBy } from "@/lib/workspace/cancelled-by";

/**
 * CANCELLED — distinct from FAILED: a deliberate stop, not an error. Says who
 * stopped it and when. `viewerEmail` is the signed-in user's, to tell "you"
 * from someone else.
 */
export function CancelledNoticeCard({ job, viewerEmail }: { job: Job; viewerEmail: string | null }) {
  const hue = HUE.CANCELLED;
  const when = job.cancel_requested_at ?? job.slurm_end ?? job.completed_at;
  const failure = job.failure;

  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader
        className={`border-b bg-gradient-to-r ${hue.gradient} to-transparent !py-4 !gap-0 grid-rows-1 items-center`}
      >
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${hue.tile}`}>
            <Ban className={`size-4 ${hue.icon}`} aria-hidden="true" />
          </div>
          Cancelled
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5 pb-6">
        <p className="min-w-0 break-words text-sm text-foreground">
          <span className="font-medium">{cancelledBy(job, viewerEmail)}</span>
          {when && (
            <>
              {" "}
              <TimeStamp value={when} format="relative" className="text-muted-foreground" />
            </>
          )}
          .
        </p>

        <RunMetadata job={job} phase={failure?.phase} />

        {failure?.excerpt && <ExcerptBlock excerpt={failure.excerpt} />}

        {job.files !== "purged" && (
          <p className="text-sm text-muted-foreground">
            Any files it wrote stay on Anvil until you delete this simulation or
            Anvil&apos;s 30-day purge removes them.
          </p>
        )}

        <DeriveSimulationButton datasetId={job.dataset_id} label="Start a new draft" fullWidth />
      </CardContent>
    </Card>
  );
}
