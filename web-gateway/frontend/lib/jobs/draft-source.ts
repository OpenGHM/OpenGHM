import type { Job } from "@/lib/jobs/types";

/** What a snapshot draft is based on: a model snapshot or a model input. */
export interface DraftSource {
  kind: "snapshot" | "model-input";
  id: string;
  title: string;
  /** The catalogue detail page, the same URL the catalogue cards link to. */
  href: string;
}

/**
 * What this snapshot draft is based on. The single place to extend when a
 * snapshot draft can start from a model input instead of a base snapshot: add the
 * `"model-input"` branch here (href `/repository/model-inputs/<id>`) and every
 * list that shows the source follows. Today every job is derived from a
 * snapshot, so it always reads `dataset_id` / `dataset_title`.
 */
export function draftSource(job: Pick<Job, "dataset_id" | "dataset_title">): DraftSource {
  return {
    kind: "snapshot",
    id: job.dataset_id,
    title: job.dataset_title,
    href: `/repository/${encodeURIComponent(job.dataset_id)}`,
  };
}
