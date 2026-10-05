import { ExcerptBlock } from "@/components/workspace/excerpt-block";
import { RunMetadata } from "@/components/workspace/run-metadata";
import { DuplicateDraftButton } from "@/components/workspace/duplicate-draft-button";
import type { Job } from "@/lib/jobs/types";
import { NEXT_STEP_COPY, offersNewDraft, type FailureCopy } from "@/lib/workspace/failure-copy";

/**
 * FAILED, under the status headline (which carries the title and the plain
 * explanation): SLURM's own state and the phase, the log excerpt that shows
 * why, and the way forward. A failed snapshot draft can't be edited in place
 * (PATCH /jobs/{id} is refused past DRAFT), so the next step is a *new* draft
 * that copies its settings (`DuplicateDraftButton`).
 */
export function FailedDetails({ job, copy }: { job: Job; copy: FailureCopy }) {
  const failure = job.failure;
  const offers = offersNewDraft(copy.nextStep);
  return (
    <div className="mt-4 space-y-4">
      <RunMetadata job={job} phase={failure?.phase} />
      {failure?.excerpt && <ExcerptBlock excerpt={failure.excerpt} />}
      {offers && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-sm text-muted-foreground">{NEXT_STEP_COPY[copy.nextStep]}</p>
          <DuplicateDraftButton jobId={job.id} />
        </div>
      )}
    </div>
  );
}
