"use client";

import type { DatasetFork } from "@/lib/workspace/dataset-forks";
import { describeChanges, type CustomParams } from "@/lib/workspace/model-parameters";
import { ChangeList } from "@/components/workspace/model-parameters/change-list";
import { useModelParameters } from "@/lib/workspace/use-model-parameters";

/**
 * The model parameters a submitted run changed, and the datasets it copied, listed as the
 * Review step lists them: how many, then each by the tree's label, the init key and its value, and
 * the readable value ("switched off", an option's label, "2.5 mm") after a dot
 * where it differs from the stored one.
 *
 * The tree is fetched for `datasetId` here, only because this is rendered only
 * when `customParams` has something in it (`RunDetailsCard` checks). The list
 * is drawn at once from the keys and raw values and gains labels when the tree
 * arrives; where the tree cannot be had (an init that cannot be read, or an
 * error) it stays as it was drawn. Nothing waits for the tree.
 */
export function RunModelParameters({
  datasetId,
  customParams,
  forks = null,
}: {
  datasetId: string;
  customParams: CustomParams | null;
  /** The datasets the run copied: each is listed as "copy of <original>, Var_Scale 1.1". */
  forks?: readonly DatasetFork[] | null;
}) {
  const { state } = useModelParameters(datasetId);
  const changes = describeChanges(customParams, state.status === "ready" ? state.tree : null, forks);
  if (changes.length === 0) return null;
  return (
    <>
      <span>{changes.length} changed</span>
      <ChangeList changes={changes} />
    </>
  );
}
