import { AlertOctagon, AlertTriangle, CloudOff } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { DuplicateSimulationButton } from "@/components/workspace/duplicate-simulation-button";
import { ExcerptBlock } from "@/components/workspace/excerpt-block";
import { RunMetadata } from "@/components/workspace/run-metadata";
import { HUE, TONE_HUE } from "@/lib/jobs/status-hue";
import type { Job } from "@/lib/jobs/types";
import {
  FAILURE_COPY,
  NEXT_STEP_COPY,
  UNRECORDED_FAILURE_COPY,
  offersNewDraft,
  type FailureTone,
} from "@/lib/workspace/failure-copy";

const TONE_ICON = {
  danger: AlertOctagon,
  warning: AlertTriangle,
  neutral: CloudOff,
} satisfies Record<FailureTone, unknown>;

/**
 * FAILED — what happened, the message and log excerpt that show why, and what
 * to do next. The title and next step per cause are `FAILURE_COPY`. The one
 * paragraph under the title is the backend's own message, which carries the
 * facts of the run; `FAILURE_COPY`'s body stands in only when there is none.
 * The excerpt is shown as it came. A failed simulation can't be
 * edited in place (PATCH /jobs/{id} is refused past DRAFT), so the next step is
 * a *new* draft that copies its settings (`DuplicateSimulationButton`).
 */
export function FailedNextStepsCard({ job }: { job: Job }) {
  const failure = job.failure;
  const copy = failure ? FAILURE_COPY[failure.cause] : UNRECORDED_FAILURE_COPY;
  const hue = HUE[TONE_HUE[copy.tone]];
  const Icon = TONE_ICON[copy.tone];
  // The backend's message is the specific one. Without a verdict, the reason
  // the job stored is all there is; without either, the per-cause body.
  const message = (failure ? failure.message : job.status_reason) || copy.body;

  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader
        className={`border-b bg-gradient-to-r ${hue.gradient} to-transparent !py-4 !gap-0 grid-rows-1 items-center`}
      >
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${hue.tile}`}>
            <Icon className={`size-4 ${hue.icon}`} aria-hidden="true" />
          </div>
          <span className="min-w-0 break-words">{copy.title}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5 pb-6">
        <p className={`min-w-0 break-words rounded-lg border p-3 text-sm text-foreground ${hue.box}`}>
          {message}
        </p>

        <RunMetadata job={job} phase={failure?.phase} />

        {failure?.excerpt && <ExcerptBlock excerpt={failure.excerpt} />}

        {offersNewDraft(copy.nextStep) && (
          <p className="text-sm text-muted-foreground">{NEXT_STEP_COPY[copy.nextStep]}</p>
        )}

        {offersNewDraft(copy.nextStep) && (
          <DuplicateSimulationButton jobId={job.id} />
        )}
      </CardContent>
    </Card>
  );
}
