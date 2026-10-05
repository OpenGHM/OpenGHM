import type { Job } from "@/lib/jobs/types";

/** What a snapshot draft is called wherever one is listed or titled: the name its
 *  owner gave it, else its slug, else its run id, else the start of its own id
 *  (a draft has no run id yet). */
export function displayName(job: Pick<Job, "id" | "about" | "slug" | "sim_id">): string {
  return job.about?.name || job.slug || job.sim_id || `Untitled (${job.id.slice(0, 8)})`;
}

/**
 * A snapshot draft's name as a list row shows it: the same rule as `displayName`,
 * except that a draft nobody named reads "Untitled draft" with the start of its
 * id apart, for the row to draw muted, rather than "Untitled (65251f85)" run
 * together. `id` is null for every snapshot draft that has a name of its own.
 */
export function listName(job: Pick<Job, "id" | "about" | "slug" | "sim_id">): { text: string; id: string | null } {
  if (job.about?.name || job.slug || job.sim_id) return { text: displayName(job), id: null };
  return { text: "Untitled draft", id: job.id.slice(0, 8) };
}
