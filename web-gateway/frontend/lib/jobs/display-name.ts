import type { Job } from "@/lib/jobs/types";

/** What a simulation is called wherever one is listed or titled: the name its
 *  owner gave it, else its slug, else its run id, else the start of its own id
 *  (a draft has no run id yet). */
export function displayName(job: Pick<Job, "id" | "about" | "slug" | "sim_id">): string {
  return job.about?.name || job.slug || job.sim_id || `Untitled (${job.id.slice(0, 8)})`;
}
