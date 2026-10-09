"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
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

/** A setting's value in its pill: green when the init switches it on, grey when not. */
function ValuePill({ on = false, children }: { on?: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-block max-w-full rounded-2xl px-2.5 py-0.5 text-xs font-semibold break-words",
        on ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
      )}
    >
      {children}
    </span>
  );
}

function SettingRow({
  label,
  initKey,
  note,
  on = false,
  children,
}: {
  label: string;
  initKey: string;
  note?: string | null;
  /** The init switches it on: its pill is green. */
  on?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid items-center gap-x-3 gap-y-1.5 border-t border-border/60 px-4 py-[11px] first:border-t-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
      <dt className="min-w-0">
        <span className="text-[13.5px] text-foreground">{label}</span>
        <code className="block font-mono text-[11.5px] break-words text-muted-foreground">{initKey}</code>
      </dt>
      <dd className="min-w-0 break-words">
        <ValuePill on={on}>{children}</ValuePill>
        {note && <span className="mt-1 block text-xs text-muted-foreground">{note}</span>}
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
    <div className="overflow-hidden rounded-[14px] border border-border/70">
      <p id={id} className="bg-muted/70 px-4 py-2.5 text-xs font-semibold text-muted-foreground">
        Set in this snapshot&apos;s init
      </p>
      <dl aria-labelledby={id}>
        <SettingRow label="Run after the simulation" initKey="Run" on={settings.run}>
          {onOff(settings.run)}
        </SettingRow>
        <SettingRow
          label="Temporal aggregation"
          initKey="Temporal_Aggregation"
          on={settings.temporalAggregation}
        >
          {onOff(settings.temporalAggregation)}
        </SettingRow>
        <SettingRow
          label="Climatology"
          initKey="Climatology"
          on={settings.climatology}
          note={settings.climatology && noTemporal ? "No effect: temporal aggregation is off." : null}
        >
          {onOff(settings.climatology)}
          {settings.climatologyDefault && " (default)"}
        </SettingRow>
        <SettingRow
          label="Multi-year climatology"
          initKey="TA_multi_year_start, TA_multi_year_timestep"
          on={settings.multiYear !== null}
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
        <SettingRow
          label="Polygon aggregation"
          initKey="Polygon_Aggregation"
          on={settings.polygonAggregation}
        >
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
  const inputId = `${id}-run`;
  const badgeId = `${id}-badge`;
  const disabled = unsupported || (climatologyOff && !checked);
  const describedBy = [noteId, climatologyOff ? badgeId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <DraftSection title="Post-processing" help="output">
      <div className="space-y-3.5">
        <div className={cn("flex items-start gap-3.5 rounded-[14px] bg-muted/70 px-4 py-3.5", disabled && "opacity-85")}>
          {/* The switch is the checkbox itself, laid transparent over its own
              track: it keeps its role, its focus, its disabled state and its
              label, and the track (drawn from its state with `peer`) is only
              the picture. */}
          <span className="relative mt-px h-6 w-10 shrink-0">
            <input
              id={inputId}
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={(event) => onChange(event.target.checked ? "climatology" : "standard")}
              aria-describedby={describedBy}
              {...draftField("postProcessing")}
              className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-checked:[&>span]:translate-x-4"
            >
              <span className="absolute top-[3px] left-[3px] size-[18px] rounded-full bg-white shadow-xs transition-transform motion-reduce:transition-none" />
            </span>
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <label
                htmlFor={inputId}
                className={cn("text-[14.5px] font-semibold text-foreground", !disabled && "cursor-pointer")}
              >
                Run post-processing after the simulation
              </label>
              {climatologyOff && (
                <span
                  id={badgeId}
                  className="rounded-full bg-warning/10 px-2 py-0.5 text-[11.5px] font-semibold text-warning"
                >
                  Not available yet
                </span>
              )}
            </div>
            {!unsupported && (
              <div id={noteId} className="space-y-0.5 text-[13px] leading-normal text-muted-foreground">
                <p>
                  {produces ??
                    "What it writes depends on the snapshot's init, which could not be read just now."}
                </p>
                {climatologyOff && (
                  <p>
                    WBM&apos;s post-processing time grows with a snapshot&apos;s size and period, and the
                    gateway does not plan for it yet.
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
        </div>
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
