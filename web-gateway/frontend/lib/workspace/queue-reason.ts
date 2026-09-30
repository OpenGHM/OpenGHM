/**
 * SLURM's reason for a pending job, in words a person can act on. The raw
 * reason is always shown beside it, so this only has to be roughly right and
 * never wrong: an unknown reason says so and quotes SLURM.
 */
export function describeQueueReason(reason: string | null | undefined): string {
  const raw = (reason ?? "").trim();
  if (raw === "" || raw === "None") return "Waiting for SLURM to schedule it.";
  if (raw === "Priority") return "Waiting for higher-priority jobs to start first.";
  if (raw === "Resources") return "Waiting for enough free cores on Anvil.";
  if (/^JobHeld(User|Admin)$/.test(raw)) return "Held — it won't start until released.";
  if (raw === "BeginTime") return "Waiting for its scheduled start time.";
  if (/^Dependency/.test(raw)) return "Waiting for another job to finish.";
  if (/^AssocGrp.*Minutes/.test(raw) || /Billing/.test(raw)) {
    return "Waiting: the allocation's compute budget is used up.";
  }
  if (/JobsLimit$/.test(raw) || /^QOSMax.*PerUser/.test(raw) || /^AssocMax/.test(raw)) {
    return "Waiting: the allocation's limit on jobs at once is reached.";
  }
  if (/^(ReqNodeNotAvail|Reservation|PartitionDown|PartitionInactive)/.test(raw) || /^maint/i.test(raw)) {
    return "Waiting: the nodes it needs are reserved or down for maintenance.";
  }
  return `Waiting (SLURM reason: ${raw}).`;
}
