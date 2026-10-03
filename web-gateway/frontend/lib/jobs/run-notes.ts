import { fetchDatasetById } from "@/lib/repository/actions";
import type { Dataset } from "@/lib/repository/types";
import { runNote } from "@/lib/jobs/run-note";
import type { Job } from "@/lib/jobs/types";

/**
 * The run note of every job in a page of the list that has one, by job id
 * (`runNote`). The job carries the title of its snapshot but not the period the
 * snapshot covers, so the distinct snapshots are read in parallel; one that is
 * gone from the repository or cannot be read costs its jobs nothing but the
 * comparison (their run period is then said as it is).
 */
export async function runNotes(jobs: Job[]): Promise<Record<string, string>> {
  const ids = [...new Set(jobs.map((job) => job.dataset_id))];
  const read = await Promise.all(
    ids.map(async (id): Promise<[string, Dataset | null]> => [id, await fetchDatasetById(id).catch(() => null)])
  );
  const snapshots = new Map(read);
  const notes: Record<string, string> = {};
  for (const job of jobs) {
    const note = runNote(job, snapshots.get(job.dataset_id) ?? null);
    if (note) notes[job.id] = note;
  }
  return notes;
}
