import { describe, expect, it } from "vitest";
import { describeQueueReason } from "@/lib/workspace/queue-reason";

describe("describeQueueReason", () => {
  it.each([
    ["Priority", "Waiting for higher-priority jobs to start first."],
    ["Resources", "Waiting for enough free cores on Anvil."],
    [null, "Waiting for SLURM to schedule it."],
    [undefined, "Waiting for SLURM to schedule it."],
    ["None", "Waiting for SLURM to schedule it."],
    ["", "Waiting for SLURM to schedule it."],
    ["AssocGrpJobsLimit", "Waiting: the allocation's limit on jobs at once is reached."],
    ["AssocMaxJobsLimit", "Waiting: the allocation's limit on jobs at once is reached."],
    ["QOSMaxJobsPerUserLimit", "Waiting: the allocation's limit on jobs at once is reached."],
    ["QOSMaxCpuPerUserLimit", "Waiting: the allocation's limit on jobs at once is reached."],
    ["ReqNodeNotAvail, Reserved for maintenance", "Waiting: the nodes it needs are reserved or down for maintenance."],
    ["Reservation", "Waiting: the nodes it needs are reserved or down for maintenance."],
    ["PartitionDown", "Waiting: the nodes it needs are reserved or down for maintenance."],
    ["PartitionInactive", "Waiting: the nodes it needs are reserved or down for maintenance."],
    ["maintenance", "Waiting: the nodes it needs are reserved or down for maintenance."],
    ["BeginTime", "Waiting for its scheduled start time."],
    ["Dependency", "Waiting for another job to finish."],
    ["JobHeldUser", "Held — it won't start until released."],
    ["JobHeldAdmin", "Held — it won't start until released."],
    ["AssocGrpCPUMinutesLimit", "Waiting: the allocation's compute budget is used up."],
    ["AssocGrpBillingMinutes", "Waiting: the allocation's compute budget is used up."],
    ["AssocGrpBillingRunMinutes", "Waiting: the allocation's compute budget is used up."],
  ])("reads %s", (reason, words) => {
    expect(describeQueueReason(reason)).toBe(words);
  });

  it("quotes a reason it does not know", () => {
    expect(describeQueueReason("SomethingNew")).toBe("Waiting (SLURM reason: SomethingNew).");
  });
});
