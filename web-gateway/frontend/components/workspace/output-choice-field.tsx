"use client";

import { useId, type ReactNode } from "react";
import { draftField } from "@/components/workspace/draft-field";
import { DraftSection } from "@/components/workspace/draft-section";
import { describeSlurmTime } from "@/lib/jobs/compute";
import type { PostProcessingChoice } from "@/lib/jobs/types";
import type { Dataset, PostProcessingSettings } from "@/lib/repository/types";

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

/** Which of the init's settings take effect: WBM writes climatology files only with
 *  temporal aggregation, and multi-year climatologies only with those. */
export function effectiveSettings(settings: PostProcessingSettings) {
  const climatology = settings.temporalAggregation && settings.climatology;
  return { climatology, multiYear: climatology ? settings.multiYear : null };
}

/** What post-processing will write for a snapshot's init, as one sentence, or null
 *  when the init could not be read (`settings` absent or null). `variableCount`
 *  gives the climatology file count; with no variable chosen it is left out. */
export function describeProducts(
  settings: PostProcessingSettings | null | undefined,
  variableCount: number
): string | null {
  if (!settings) return null;
  const effective = effectiveSettings(settings);
  const items: string[] = [];
  if (effective.climatology) {
    const files = variableCount * CLIMATOLOGY_FILES_PER_VARIABLE;
    items.push(
      `daily, monthly and yearly climatologies of each output variable${files > 0 ? ` (${files} files)` : ""}`
    );
    if (effective.multiYear) {
      const { start, step } = effective.multiYear;
      items.push(`yearly climatologies over ${step}-year periods from ${start}`);
    }
  }
  if (settings.polygonAggregation) items.push("aggregates over polygons");
  if (items.length === 0) {
    return "This snapshot's init sets nothing for post-processing to write, so running it produces nothing.";
  }
  const joined = items.length === 1 ? items[0] : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  return `Writes ${joined}.`;
}

function SettingRow({
  label,
  initKey,
  note,
  children,
}: {
  label: string;
  initKey: string;
  note?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-0.5 px-2.5 py-1.5 sm:grid-cols-[11rem_1fr] sm:gap-3">
      <dt className="min-w-0">
        <span className="text-foreground">{label}</span>
        <code className="block break-words font-mono text-[0.6875rem] text-muted-foreground">{initKey}</code>
      </dt>
      <dd className="min-w-0 break-words text-foreground">
        {children}
        {note && <span className="block text-muted-foreground">{note}</span>}
      </dd>
    </div>
  );
}

const onOff = (value: boolean) => (value ? "On" : "Off");

/** What the snapshot's init `PostProcessing` block sets, row by row and read-only,
 *  with the setting that has no effect because one it depends on is off marked. */
function InitSettingsList({ settings }: { settings: PostProcessingSettings }) {
  const id = useId();
  const noTemporal = !settings.temporalAggregation;
  const noClimatology = settings.temporalAggregation && !settings.climatology;
  return (
    <div className="ml-[1.625rem] rounded-md border bg-muted/30 text-xs">
      <p id={id} className="px-2.5 pt-2 pb-0.5 font-medium text-foreground">
        Set in this snapshot&apos;s init
      </p>
      <dl aria-labelledby={id} className="divide-y">
        <SettingRow label="Run after the simulation" initKey="Run">
          {onOff(settings.run)}
        </SettingRow>
        <SettingRow label="Temporal aggregation" initKey="Temporal_Aggregation">
          {onOff(settings.temporalAggregation)}
        </SettingRow>
        <SettingRow
          label="Climatology"
          initKey="Climatology"
          note={settings.climatology && noTemporal ? "No effect: temporal aggregation is off." : null}
        >
          {onOff(settings.climatology)}
          {settings.climatologyDefault && <span className="text-muted-foreground"> (default)</span>}
        </SettingRow>
        <SettingRow
          label="Multi-year climatology"
          initKey="TA_multi_year_start, TA_multi_year_timestep"
          note={
            !settings.multiYear
              ? null
              : noTemporal
                ? "No effect: temporal aggregation is off."
                : noClimatology
                  ? "No effect: climatology is off."
                  : null
          }
        >
          {settings.multiYear
            ? `Every ${settings.multiYear.step} ${settings.multiYear.step === 1 ? "year" : "years"} from ${settings.multiYear.start}`
            : "Not set"}
        </SettingRow>
        <SettingRow label="Polygon aggregation" initKey="Polygon_Aggregation">
          {settings.polygonAggregation ? "Set" : "Not set"}
        </SettingRow>
        <SettingRow
          label="Forks"
          initKey="Forks"
          note="A run that post-processes uses its job's cores instead."
        >
          {settings.forks === null ? "Not set (WBM's default is 8)" : settings.forks}
        </SettingRow>
      </dl>
    </div>
  );
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
 * init (`describeProducts`, from `postProcessingSettings`), and below it a read-only list of
 * what the init's `PostProcessing` block sets, key by key (`InitSettingsList`); nothing in it is editable.
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
  const produces = unsupported ? null : describeProducts(dataset?.postProcessingSettings, variableCount);
  const settings = unsupported ? null : (dataset?.postProcessingSettings ?? null);
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
        {settings && <InitSettingsList settings={settings} />}
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
