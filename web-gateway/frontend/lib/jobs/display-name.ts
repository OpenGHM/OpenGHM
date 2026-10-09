import type { Job } from "@/lib/jobs/types";

/** What a published snapshot or model input is called where space is short:
 *  lists, cards, headers, "Based on" lines. Its `about.shortName` when it has
 *  one, else its `about.name`, which stays the full, citable title (the
 *  citation, the JSON-LD `name` and every `title` tooltip on a short name keep
 *  it). Takes anything with a `name` and an optional `shortName`, so the
 *  catalogue's `about` block and a stored title pair both fit. */
export function aboutName(about: { name: string; shortName?: string | null }): string {
  return about.shortName?.trim() || about.name;
}

/** The snapshot a job is based on, named as `aboutName` names one: the title
 *  and short name copied onto the job when it was made. A job made before the
 *  short name existed has none, and reads its full title as before. */
export function basedOnName(job: Pick<Job, "dataset_title" | "dataset_short_title">): string {
  return aboutName({ name: job.dataset_title, shortName: job.dataset_short_title });
}

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
