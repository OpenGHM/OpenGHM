"use client";

import { useId } from "react";
import { draftField } from "@/components/workspace/draft-field";
import { DraftSection } from "@/components/workspace/draft-section";
import type { PostProcessingChoice } from "@/lib/jobs/types";
import type { Dataset } from "@/lib/repository/types";

/** What a draft computes when it has no choice of its own: the snapshot's. A
 *  snapshot whose init could not be read counts as the standard output, which
 *  is what every published snapshot has. */
export function snapshotOutput(dataset: Dataset | null): PostProcessingChoice {
  return dataset?.postProcessing === "climatology" ? "climatology" : "standard";
}

/** WBM writes a daily, a monthly and a yearly climatology file per output variable. */
const CLIMATOLOGY_FILES_PER_VARIABLE = 3;

const RADIO = "mt-0.5 size-4 shrink-0 accent-primary";

function Choice({
  name,
  value,
  checked,
  label,
  hint,
  disabled,
  onSelect,
  children,
}: {
  name: string;
  value: PostProcessingChoice;
  checked: boolean;
  label: string;
  hint?: string;
  disabled: boolean;
  onSelect: (value: PostProcessingChoice) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="flex min-h-10 cursor-pointer items-start gap-2.5 py-2 sm:min-h-8 sm:py-1">
        <input
          type="radio"
          name={name}
          value={value}
          checked={checked}
          disabled={disabled}
          onChange={() => onSelect(value)}
          className={RADIO}
        />
        <span className="min-w-0 text-sm">
          <span className="font-medium text-foreground">{label}</span>
          {hint && <span className="text-muted-foreground"> · {hint}</span>}
        </span>
      </label>
      {children}
    </div>
  );
}

/**
 * The "Output" part of Run settings: what WBM writes. Two choices, as a radio
 * group: the daily, monthly and yearly output every published snapshot has, or
 * that and WBM's climatologies (`post_processing`, which `sim run` passes as
 * `--post-processing`). It shows the draft's own choice, and the snapshot's
 * when the draft has none (`snapshotOutput`); picking a value stores that
 * value, even when it is the snapshot's own, and the backend passes the flag
 * only when it differs. A snapshot whose init has no post-processing settings
 * (`postProcessing === "none"`) shows the group disabled, with a line saying so.
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
  const shown = value ?? snapshotOutput(dataset);
  const files = variableCount * CLIMATOLOGY_FILES_PER_VARIABLE;
  const noteId = `${id}-note`;
  const errorId = `${id}-error`;

  return (
    <DraftSection title="Output">
      <div
        role="radiogroup"
        aria-label="Output"
        aria-describedby={[unsupported || shown === "climatology" ? noteId : null, error ? errorId : null]
          .filter(Boolean)
          .join(" ") || undefined}
        {...draftField("postProcessing")}
        className="space-y-1"
      >
        <Choice
          name={`${id}-output`}
          value="standard"
          checked={shown === "standard"}
          label="Daily, monthly and yearly"
          hint="as the published simulation"
          disabled={unsupported}
          onSelect={onChange}
        />
        <Choice
          name={`${id}-output`}
          value="climatology"
          checked={shown === "climatology"}
          label="Also climatology"
          disabled={unsupported}
          onSelect={onChange}
        >
          {!unsupported && (
            <div id={noteId} className="ml-[1.625rem] space-y-0.5 text-xs text-muted-foreground">
              <p>
                WBM&apos;s post-processing runs after the simulation and writes daily, monthly and yearly
                climatologies over the period for each output variable
                {files > 0 ? `: ${files} files for this snapshot.` : "."}
              </p>
              <p>
                Measured on the CONUS tutorial snapshot: about a fifth more run time, and 2.2 GB of
                climatology on 1.5 GB of output.
              </p>
            </div>
          )}
        </Choice>
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
