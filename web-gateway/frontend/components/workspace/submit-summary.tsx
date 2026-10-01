import type { ReactNode } from "react";
import { describeSlurmTime, describeUnsupportedField } from "@/lib/jobs/compute";
import type { ActionFailure } from "@/lib/jobs/types";

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
    case "not_a_draft":
      return "This simulation was already submitted or was changed in the meantime. Reload the page to see where it stands.";
    default:
      // anvil_unreachable, sbatch_rejected, anvil_not_configured,
      // email_not_verified, account_inactive, invalid_parameters, ...
      return failure.message;
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
 * the run period, the output variables, cores and walltime, and whose
 * allocation it is. `cores` and `walltime` are what SLURM will be asked for
 * (`effectiveCompute`); `*FromSnapshot` says the draft left them unset, which
 * means the snapshot's recommendation for cores and the recommendation plus 50%
 * for walltime.
 */
export function SubmitSummary({
  snapshotTitle,
  start,
  end,
  variables,
  cores,
  coresFromSnapshot,
  walltime,
  walltimeFromSnapshot,
}: {
  snapshotTitle: string;
  start: string;
  end: string;
  variables: string[];
  cores: number | null;
  coresFromSnapshot: boolean;
  walltime: string | null;
  walltimeFromSnapshot: boolean;
}) {
  return (
    <>
      <dl className="space-y-1.5 text-sm">
        <SummaryRow label="Model Snapshot">{snapshotTitle}</SummaryRow>
        <SummaryRow label="Run period">
          {start} to {end}
        </SummaryRow>
        <SummaryRow label={`Output variables (${variables.length})`}>
          {variables.length > 0 ? variables.join(", ") : "None chosen"}
        </SummaryRow>
        <SummaryRow label="Cores">
          {cores ?? "Not known"}
          <Recommendation show={cores !== null && coresFromSnapshot}>
            model snapshot&apos;s recommendation
          </Recommendation>
        </SummaryRow>
        <SummaryRow label="Walltime">
          {walltime ? describeSlurmTime(walltime) : "Not known"}
          <Recommendation show={walltime !== null && walltimeFromSnapshot}>
            model snapshot&apos;s recommendation + 50%
          </Recommendation>
        </SummaryRow>
      </dl>
      <p className="text-sm text-muted-foreground">Runs on the shared ees260008 allocation.</p>
    </>
  );
}
