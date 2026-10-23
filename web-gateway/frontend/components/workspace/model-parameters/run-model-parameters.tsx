"use client";

import { describeChanges, type CustomParams } from "@/lib/workspace/model-parameters";
import { useModelParameters } from "@/lib/workspace/use-model-parameters";

/**
 * The model parameters a submitted run changed, listed as the Review step lists
 * them: how many, then each by the tree's label, the init key and its value, and
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
}: {
  datasetId: string;
  customParams: CustomParams;
}) {
  const { state } = useModelParameters(datasetId);
  const changes = describeChanges(customParams, state.status === "ready" ? state.tree : null);
  if (changes.length === 0) return null;
  return (
    <>
      <span>{changes.length} changed</span>
      <ul className="mt-1 space-y-1">
        {changes.map((change) => (
          <li key={`${change.kind}:${change.path}`} className="min-w-0 text-[13px] font-normal">
            {change.label && <span className="mr-1.5">{change.label}</span>}
            {change.kind === "switched_on" ? (
              <>
                <code className="font-mono text-xs break-all text-muted-foreground">{change.path}</code>
                <span className="text-muted-foreground"> · {change.shown}</span>
              </>
            ) : (
              <>
                <code className="font-mono text-xs break-all text-muted-foreground">
                  {change.path} = {change.value === "" ? "''" : change.value}
                </code>
                {change.shown !== change.value && <span className="text-muted-foreground"> · {change.shown}</span>}
              </>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
