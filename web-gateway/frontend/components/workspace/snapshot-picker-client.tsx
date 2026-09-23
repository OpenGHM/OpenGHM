"use client";

import { useRouter } from "next/navigation";
import { SnapshotPicker } from "./snapshot-picker";
import type { Dataset, FilterState, RepositoryListResponse } from "@/lib/repository/types";

/**
 * Wires `SnapshotPicker`'s commit action to navigation: selecting a
 * snapshot pushes to the configure step with the chosen id, and creates
 * nothing — `POST /jobs/derive/{dataset_id}` only ever fires from the
 * Review step (`wizard-review-step.tsx`), unchanged by this mission.
 */
export function SnapshotPickerClient({
  initialFilters,
  initialData,
  initialModelInputIds,
}: {
  initialFilters: FilterState;
  initialData: RepositoryListResponse;
  initialModelInputIds: Set<string> | null;
}) {
  const router = useRouter();

  const handleSelect = (dataset: Dataset) => {
    router.push(`/workspace/new/configure?snapshotId=${encodeURIComponent(dataset.id)}`);
  };

  return (
    <SnapshotPicker
      initialFilters={initialFilters}
      initialData={initialData}
      initialModelInputIds={initialModelInputIds}
      onSelect={handleSelect}
    />
  );
}
