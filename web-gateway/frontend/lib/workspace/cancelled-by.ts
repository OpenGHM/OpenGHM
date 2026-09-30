import type { Job } from "@/lib/jobs/types";

/** Who stopped it, as the start of a sentence. Without a recorded verdict or
 *  cancel request (an old job) nothing says who, so nothing is claimed. */
export function cancelledBy(
  job: Pick<Job, "failure" | "cancel_requested_at" | "cancel_requested_by_email">,
  viewerEmail: string | null
): string {
  const cause = job.failure?.cause;
  if (cause === "cancelled_by_system") return "Cancelled by Anvil or an administrator";
  if (cause !== "cancelled_by_user" && job.cancel_requested_at === null) return "Cancelled";
  const who = job.cancel_requested_by_email;
  if (!who) return "Cancelled by its owner";
  if (viewerEmail && who.toLowerCase() === viewerEmail.toLowerCase()) {
    return "You cancelled this simulation";
  }
  return `Cancelled by ${who}`;
}
