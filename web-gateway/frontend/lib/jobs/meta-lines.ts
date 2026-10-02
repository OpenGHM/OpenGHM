import { fetchDatasetById } from "@/lib/repository/actions";
import type { Dataset } from "@/lib/repository/types";
import { simulationMetaLine } from "@/lib/jobs/based-on";
import type { Job } from "@/lib/jobs/types";

/**
 * The meta line of every job in a page of the list, by job id. The distinct
 * snapshots are read in parallel; one that is gone from the repository or
 * cannot be read costs its jobs only the short name.
 */
export async function simulationMetaLines(jobs: Job[]): Promise<Record<string, string>> {
  const ids = [...new Set(jobs.map((job) => job.dataset_id))];
  const read = await Promise.all(
    ids.map(async (id): Promise<[string, Dataset | null]> => [id, await fetchDatasetById(id).catch(() => null)])
  );
  const snapshots = new Map(read);
  return Object.fromEntries(jobs.map((job) => [job.id, simulationMetaLine(job, snapshots.get(job.dataset_id) ?? null)]));
}
