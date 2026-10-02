import { DraftStepHeading } from "@/components/workspace/draft-step-heading";
import { ModelInputBrowser } from "@/components/workspace/model-input-browser";
import { ModelInputPanel } from "@/components/workspace/model-input-panel";
import { SnapshotSummaryCard } from "@/components/workspace/snapshot-summary-card";
import type { ModelInput } from "@/lib/repository/types";
import type { DraftContext } from "@/lib/workspace/draft-state";
import { effectiveModelInputId } from "@/lib/workspace/use-catalogue-model-input";

/**
 * Step 2, "Model & input": the snapshot the draft started from (it cannot be
 * changed), the model input it runs against, and the catalogue to browse. The
 * only thing to change here is reverting a stored override.
 *
 * `resolvedModelInput` is `useCatalogueModelInput(effectiveModelInputId(...))`,
 * looked up once by the wizard and shared with the review step.
 */
export function DraftModelStep({
  datasetId,
  datasetTitle,
  ctx,
  modelInputId,
  resolvedModelInput,
  onRevertModelInput,
  error,
  disabled = false,
}: {
  datasetId: string;
  datasetTitle: string;
  ctx: DraftContext;
  /** The draft's own override; null inherits the snapshot's. */
  modelInputId: string | null;
  resolvedModelInput: ModelInput | null | undefined;
  onRevertModelInput: () => void;
  /** What the server said about `modelInput`, if it refused it. */
  error?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-6">
      <DraftStepHeading step="model">
        Where this simulation starts, and the model input it runs against.
      </DraftStepHeading>
      <SnapshotSummaryCard ctx={ctx} datasetId={datasetId} fallbackTitle={datasetTitle} />
      <div className="space-y-3">
        <ModelInputPanel
          modelInputId={modelInputId}
          inheritedId={ctx.dataset?.uses.modelInput.id ?? null}
          resolved={resolvedModelInput}
          onRevert={onRevertModelInput}
          disabled={disabled}
          error={error}
        />
        <ModelInputBrowser currentId={effectiveModelInputId(modelInputId, ctx.dataset)} />
      </div>
    </div>
  );
}
