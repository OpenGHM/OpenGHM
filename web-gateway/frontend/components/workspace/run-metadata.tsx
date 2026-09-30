import type { JobVerdictFields } from "@/lib/jobs/types";

/** SLURM's own state and exit code, and the phase the job reached, as small
 *  muted text. Nothing is shown for a field that is not set. */
export function RunMetadata({
  job,
  phase,
}: {
  job: Pick<JobVerdictFields, "slurm_state" | "slurm_exit_code">;
  phase?: string | null;
}) {
  const items = [
    job.slurm_state && { label: "SLURM state", value: job.slurm_state },
    job.slurm_exit_code && { label: "Exit code", value: job.slurm_exit_code },
    phase && { label: "Phase", value: phase },
  ].filter((i): i is { label: string; value: string } => Boolean(i));
  if (items.length === 0) return null;
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <div key={i.label} className="flex min-w-0 gap-1.5">
          <dt>{i.label}</dt>
          <dd className="min-w-0 break-words font-mono text-foreground/80">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
