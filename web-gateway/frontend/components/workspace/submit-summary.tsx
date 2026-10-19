import type { ReactNode } from "react";
import {
  automaticWalltimeLabel,
  describeDuration,
  describeUnsupportedField,
} from "@/lib/jobs/compute";
import { ClampedName } from "@/components/common/clamped-name";
import { describeOutput } from "@/components/workspace/output-choice-field";
import type { ActionFailure, PostProcessingChoice } from "@/lib/jobs/types";

/** The words a person reads when a submit does not go through. The backend's
 *  own `message` is kept where it is already plain and carries the detail
 *  (SLURM's refusal, the verification link). */
export function describeSubmitFailure(
  failure: Extract<ActionFailure, { reason: "error" }>
): string {
  switch (failure.code) {
    case "not_permitted_to_run":
      return "You are not permitted to run simulations yet. Ask an administrator to allow you to run simulations.";
    case "active_job_limit":
      return "You already have the most active simulations you can have. Wait for one to finish, or cancel one, then submit again.";
    case "unsupported_fields":
      return `These settings cannot run yet: ${(failure.fields ?? [])
        .map(describeUnsupportedField)
        .join(", ")}. Put them back to the model snapshot's own values, save, and submit again.`;
    case "run_over_limit":
      // The backend's sentence says how long the run is estimated to take and
      // what the limit is.
      return failure.message;
    case "answered_by_published":
      return "The model snapshot already publishes these results, so nothing was run. Use Run anyway if you want to run it again.";
    case "not_a_draft":
      return "This snapshot draft was already submitted or was changed in the meantime. Reload the page to see where it stands.";
    default:
      // anvil_unreachable, sbatch_rejected, anvil_not_configured,
      // email_not_verified, account_inactive, invalid_parameters, the
      // unreachable-backend and 5xx sentences of `describeFailure`, ...:
      // whatever the code, the backend's own sentence.
      return failure.message || "The submit did not go through. Your draft is unchanged.";
  }
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 rounded-md bg-muted/40 px-3 py-2 sm:grid-cols-[8rem_1fr] sm:gap-3">
      <dt className="text-xs text-muted-foreground sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-foreground">{children}</dd>
    </div>
  );
}

function Recommendation({ show, children }: { show: boolean; children: ReactNode }) {
  return show ? (
    <span className="font-normal text-muted-foreground"> ({children})</span>
  ) : null;
}

/**
 * What a submit will run and spend, for the confirmation dialog: the snapshot,
 * the run period, the output variables, the output, cores and the estimated
 * run time, and whose allocation it is. `cores` is what SLURM will be asked for
 * (`effectiveCompute`); `coresFromSnapshot` says the draft left it unset, which
 * means the snapshot's recommendation. The estimated run time is the
 * snapshot's recommended time plus 50% (`estimatedRunSeconds`), with its
 * post-processing time added when the run asks for climatology
 * (`estimateIncludesPostProcessing`).
 */
export function SubmitSummary({
  snapshotTitle,
  start,
  end,
  variables,
  output = "standard",
  cores,
  coresFromSnapshot,
  estimatedSeconds,
  estimateIncludesPostProcessing = false,
  coresWarning = null,
}: {
  snapshotTitle: string;
  start: string;
  end: string;
  variables: string[];
  /** What the run computes: the draft's choice, else the snapshot's own. */
  output?: PostProcessingChoice;
  cores: number | null;
  coresFromSnapshot: boolean;
  /** How long the run is estimated to take (`estimatedRunSeconds`); null when
   *  the snapshot is unknown. */
  estimatedSeconds: number | null;
  /** The estimate has the snapshot's post-processing time in it. */
  estimateIncludesPostProcessing?: boolean;
  /** `describeCoresBelowRecommended`: shown under Cores, because the dialog is
   *  the last place to notice it. A hint; Submit stays on. */
  coresWarning?: string | null;
}) {
  return (
    <>
      <dl className="space-y-1.5 text-sm">
        <SummaryRow label="Model Snapshot">
          <ClampedName lines={3}>{snapshotTitle}</ClampedName>
        </SummaryRow>
        <SummaryRow label="Run period">
          {start} to {end}
        </SummaryRow>
        <SummaryRow label={`Output variables (${variables.length})`}>
          {variables.length > 0 ? variables.join(", ") : "None chosen"}
        </SummaryRow>
        <SummaryRow label="Post-processing">{describeOutput(output)}</SummaryRow>
        <SummaryRow label="Cores">
          {cores ?? "Not known"}
          <Recommendation show={cores !== null && coresFromSnapshot}>
            model snapshot&apos;s recommendation
          </Recommendation>
          {coresWarning && (
            <span className="mt-1 block text-xs font-normal text-warning">{coresWarning}</span>
          )}
        </SummaryRow>
        <SummaryRow label="Estimated run time">
          {estimatedSeconds !== null ? describeDuration(estimatedSeconds) : "Not known"}
          <Recommendation show={estimatedSeconds !== null}>
            {automaticWalltimeLabel("summary", estimateIncludesPostProcessing)}
          </Recommendation>
        </SummaryRow>
      </dl>
      <p className="text-sm text-muted-foreground">Runs on the shared ees260008 allocation.</p>
    </>
  );
}
