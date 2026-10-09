"use client";

import { useId } from "react";
import { draftField } from "@/components/workspace/draft-field";
import { DraftSection } from "@/components/workspace/draft-section";
import { describeSlurmTime } from "@/lib/jobs/compute";
import type { PostProcessingChoice } from "@/lib/jobs/types";
import type { Dataset, PostProcessingProducts } from "@/lib/repository/types";

/** What a draft computes when it has no choice of its own: the snapshot's. A
 *  snapshot whose init could not be read counts as the standard output, which
 *  is what every published snapshot has. */
export function snapshotOutput(dataset: Dataset | null): PostProcessingChoice {
  return dataset?.postProcessing === "climatology" ? "climatology" : "standard";
}

/** The words for what a draft computes, wherever it is summarised: whether WBM's
 *  post-processing runs after the simulation. */
export function describeOutput(choice: PostProcessingChoice): string {
  return choice === "climatology" ? "On" : "Off";
}

/** WBM writes a daily, a monthly and a yearly climatology file per output variable. */
const CLIMATOLOGY_FILES_PER_VARIABLE = 3;

/** What post-processing will write for a snapshot's init, as one sentence, or null
 *  when the init could not be read (`products` absent or null). `variableCount`
 *  gives the climatology file count; with no variable chosen it is left out. */
export function describeProducts(
  products: PostProcessingProducts | null | undefined,
  variableCount: number
): string | null {
  if (!products) return null;
  const items: string[] = [];
  if (products.climatology) {
    const files = variableCount * CLIMATOLOGY_FILES_PER_VARIABLE;
    items.push(
      `daily, monthly and yearly climatologies of each output variable${files > 0 ? ` (${files} files)` : ""}`
    );
    if (products.multiYear) {
      const { start, step } = products.multiYear;
      items.push(`yearly climatologies over ${step}-year periods from ${start}`);
    }
  }
  if (products.polygonAggregation) items.push("aggregates over polygons");
  if (items.length === 0) {
    return "This snapshot's init sets nothing for post-processing to write, so running it produces nothing.";
  }
  const joined = items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  return `Writes ${joined}.`;
}

const CHECKBOX = "mt-0.5 size-4 shrink-0 accent-primary";

/**
 * The "Post-processing" part of Run settings: whether WBM's post-processing runs
 * after the simulation, as one checkbox ("Run post-processing after the
 * simulation"). WBM writes daily, monthly and yearly output whenever the init has a
 * post-processing block; the checkbox is the init's `PostProcessing => { Run }`,
 * stored as `post_processing` (checked is `climatology`, unchecked `standard`, which
 * `sim run` passes as `--post-processing`). It shows the draft's own value, and the
 * snapshot's when the draft has none (`snapshotOutput`); toggling stores the value,
 * even when it is the snapshot's own, and the backend passes the flag only when it
 * differs. The line under it says what post-processing writes for this snapshot's
 * init (`describeProducts`, from `postProcessingProducts`).
 *
 * A snapshot whose init has no post-processing settings (`postProcessing === "none"`)
 * shows the checkbox disabled, with a line saying so. While climatology is not
 * available (`climatologyAvailable` is not true, absent included: the backend has it
 * switched off, or the snapshot has no measured post-processing time) an unchecked
 * checkbox is disabled and its note says why, which is the same line for both
 * causes, under the line of what it would write. A stored draft that already asks for it shows it checked, and can still be
 * unchecked; the server's refusal (`climatology_unavailable`) lands on the field.
 * Otherwise a second line gives the snapshot's own measured time
 * (`postProcessingWalltime`), which the walltime the draft asks for then includes.
 */
export function OutputChoiceSection({
  dataset,
  value,
  variableCount,
  error,
  onChange,
}: {
  dataset: Dataset | null;
  /** The draft's own choice; null is the snapshot's. */
  value: PostProcessingChoice | null;
  /** How many output variables the draft has chosen. */
  variableCount: number;
  /** What the server said about the choice. */
  error: string | null;
  onChange: (value: PostProcessingChoice) => void;
}) {
  const id = useId();
  const unsupported = dataset?.postProcessing === "none";
  const climatologyOff = !unsupported && dataset?.climatologyAvailable !== true;
  const compute = dataset?.simulation.recommendedCompute;
  const shown = value ?? snapshotOutput(dataset);
  const checked = shown === "climatology";
  const produces = unsupported ? null : describeProducts(dataset?.postProcessingProducts, variableCount);
  const noteId = `${id}-note`;
  const errorId = `${id}-error`;
  const describedBy = [noteId, error ? errorId : null].join(" ");

  return (
    <DraftSection title="Post-processing" help="output">
      <div className="space-y-1">
        <label className="flex min-h-10 cursor-pointer items-start gap-2.5 py-2 sm:min-h-8 sm:py-1">
          <input
            type="checkbox"
            checked={checked}
            disabled={unsupported || (climatologyOff && !checked)}
            onChange={(event) => onChange(event.target.checked ? "climatology" : "standard")}
            aria-describedby={describedBy}
            {...draftField("postProcessing")}
            className={CHECKBOX}
          />
          <span className="min-w-0 text-sm font-medium text-foreground">Run post-processing after the simulation</span>
        </label>
        {!unsupported && (
          <div id={noteId} className="ml-[1.625rem] space-y-0.5 text-xs text-muted-foreground">
            <p>
              {produces ??
                "What it writes depends on the snapshot's init, which could not be read just now."}
            </p>
            {climatologyOff && (
              <p>
                Not available yet: WBM&apos;s post-processing time grows with a snapshot&apos;s size and
                period, and the gateway does not plan for it yet.
              </p>
            )}
            {!climatologyOff && compute?.postProcessingWalltime && (
              <p>
                Measured on this snapshot&apos;s reference period at {compute.cores}{" "}
                {compute.cores === 1 ? "core" : "cores"}: about{" "}
                {describeSlurmTime(compute.postProcessingWalltime)} on top of the run time, which the
                walltime then includes.
              </p>
            )}
          </div>
        )}
      </div>
      {unsupported && (
        <p id={noteId} className="text-xs text-muted-foreground">
          This snapshot&apos;s init has no post-processing settings.
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </DraftSection>
  );
}
