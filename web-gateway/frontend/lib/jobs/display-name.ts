import type { Job } from "@/lib/jobs/types";
import { runPeriodLabel } from "@/lib/jobs/run-period-label";
import { splitVersion } from "@/lib/jobs/title-version";

type Named = Pick<Job, "id" | "about" | "slug" | "sim_id"> & Partial<Pick<Job, "dataset_title" | "parameters">>;

/** The years a snapshot's title carries: a tag, "[2000-2009]", or a trailing
 *  "…, 2000–2001". */
const TITLE_YEAR_TAG = /\s*\[\d{4}(?:\s*[–-]\s*\d{4})?\]/g;
const TITLE_YEARS = /[\s,:;·-]*\d{4}(?:\s*[–-]\s*\d{4})?\s*$/;

/**
 * A name for a snapshot draft nobody named: the short title of the snapshot it
 * is based on (its version and its years left out, `splitVersion`)
 * and the period it runs (`runPeriodLabel`): "WBM CONUS tutorial simulation ·
 * 2000–2001". Null when there is no title to make it from. Only ever shown, never
 * stored: the run id (`sim_id`) is a separate thing, and a name is a label, not a
 * key.
 */
export function defaultName(job: Pick<Named, "dataset_title" | "parameters">): string | null {
  const title = splitVersion(job.dataset_title ?? "")
    .rest.replace(TITLE_YEAR_TAG, "")
    .replace(TITLE_YEARS, "")
    .replace(/[\s,:;·-]+$/, "");
  if (!title) return null;
  const period = runPeriodLabel(job.parameters?.temporal_range_start, job.parameters?.temporal_range_end);
  return period ? `${title} · ${period}` : title;
}

/** What a snapshot draft is called wherever one is listed or titled: the name its
 *  owner gave it, else its slug, else one made of its snapshot's title and run
 *  period (`defaultName`), else its run id, else the start of its own id. */
export function displayName(job: Named): string {
  return job.about?.name || job.slug || defaultName(job) || job.sim_id || `Untitled (${job.id.slice(0, 8)})`;
}

/**
 * A snapshot draft's name as a list row shows it: the same rule as `displayName`,
 * and, for a draft nobody named, the run id apart for the row to draw muted
 * under it (the start of the draft's own id while it has no run id yet), so the
 * list is a column of readable names and each row still says which run it is.
 * `id` is null for every snapshot draft that has a name of its own.
 */
export function listName(job: Named): { text: string; id: string | null } {
  if (job.about?.name || job.slug) return { text: displayName(job), id: null };
  const made = defaultName(job);
  if (made) return { text: made, id: job.sim_id || job.id.slice(0, 8) };
  if (job.sim_id) return { text: job.sim_id, id: null };
  return { text: "Untitled draft", id: job.id.slice(0, 8) };
}
