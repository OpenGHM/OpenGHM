"use client";

import { useId, useState, type ComponentType, type ReactNode } from "react";
import { ChevronDown, Lock, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatasetForkPanel, isDataInit } from "@/components/workspace/model-parameters/dataset-fork-panel";
import { cn } from "@/lib/utils";
import type { DatasetFork } from "@/lib/workspace/dataset-forks";
import {
  calibrationBar,
  defaultDiffers,
  displayValue,
  effectiveValue,
  hasCandidates,
  isChanged,
  isConstantForDataset,
  isEditableField,
  valueType,
  type CustomParams,
  type DatasetCandidate,
  type FieldType,
  type ParamField,
} from "@/lib/workspace/model-parameters";

/** What every control of a field gets: the value it shows (the draft's own, else
 *  the snapshot's, `""` when neither) and one way to change it. */
export interface FieldControlProps {
  field: ParamField;
  id: string;
  value: string;
  /** `aria-describedby` for the control: the ids of its hints and error. */
  describedBy?: string;
  invalid: boolean;
  onChange: (value: string) => void;
}

const CONTROL_INPUT = "h-10 rounded-lg font-mono md:text-sm";

/** A number, or an integer (`step` 1: the browser flags a fraction). `min` and
 *  `max` are the tree's; the unit sits inside the box, at its right end. */
function NumberControl({ field, id, value, describedBy, invalid, onChange }: FieldControlProps) {
  const unit = field.unit;
  return (
    <div className="relative min-w-0 flex-1">
      <Input
        id={id}
        type="number"
        inputMode={field.type === "int" ? "numeric" : "decimal"}
        step={field.type === "int" ? 1 : "any"}
        placeholder={field.edit_as === "number" ? "Constant" : undefined}
        min={field.min ?? undefined}
        max={field.max ?? undefined}
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        style={unit ? { paddingRight: `calc(${unit.length}ch + 1.75rem)` } : undefined}
        className={cn(
          CONTROL_INPUT,
          unit && "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        )}
        onChange={(e) => onChange(e.target.value)}
      />
      {unit && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] text-muted-foreground">
          {unit}
        </span>
      )}
    </div>
  );
}

const SELECT =
  "h-10 w-full appearance-none rounded-lg border border-input bg-card pr-9 pl-3 text-base outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30";

/** A native `<select>` in the style of the inputs, with its own chevron (the browser's is hidden). */
function SelectBox({
  children,
  className,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <select {...props} className={SELECT}>
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

/** A choice, with the tree's labels. A value that is not among the options (an
 *  init that holds something else) is listed as it is, so the select shows it. */
function EnumControl({ field, id, value, describedBy, invalid, onChange }: FieldControlProps) {
  const options = field.options ?? [];
  const listed = options.some((o) => o.value === value);
  return (
    <SelectBox
      id={id}
      value={value}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value)}
    >
      {value === "" && (
        <option value="" disabled>
          Not set
        </option>
      )}
      {value !== "" && !listed && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </SelectBox>
  );
}

/** What a dataset is called in a list: its name, time step and unit. */
const candidateLabel = (c: DatasetCandidate) =>
  `${c.name} · ${c.time_series || "no time series"} · ${c.unit || "no unit"}`;

/** One of the datasets of the snapshot's model input, all in the field's unit, or, where the field
 *  also takes a number (`edit_as`), a constant typed beside the select: both write the same key. A
 *  dataset WBM cannot read is listed, greyed and not chosen (the reason is under the field). A
 *  required field has no "not set". */
function CandidateControl({ field, id, value, describedBy, invalid, onChange }: FieldControlProps) {
  const candidates = field.candidates ?? [];
  const takesNumber = field.edit_as === "number";
  const listed = candidates.some((c) => c.value === value);
  const constant = takesNumber && value !== "" && !listed && Number.isFinite(Number(value));
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <SelectBox
        id={id}
        value={constant ? "" : value}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled={field.required === true && !takesNumber}>
          {field.required ? "Choose a dataset…" : "Not set"}
        </option>
        {value !== "" && !listed && !constant && <option value={value}>{value}</option>}
        {candidates.map((c) => (
          <option key={c.value} value={c.value} disabled={c.disabled !== null} title={c.disabled ?? undefined}>
            {candidateLabel(c)}
            {c.disabled !== null && " (cannot be used)"}
          </option>
        ))}
      </SelectBox>
      {takesNumber && (
        <Input
          type="number"
          inputMode="decimal"
          step="any"
          placeholder="or a constant"
          aria-label={`${field.label}, a constant`}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          value={constant ? value : ""}
          className={CONTROL_INPUT}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

/** A 0/1 flag as a switch: on writes "1", off "0". The checkbox is the switch
 *  itself, laid transparent over its own track (as in post-processing), so it
 *  keeps its role, focus and label. */
function BoolControl({ field, id, value, describedBy, invalid, onChange }: FieldControlProps) {
  const checked = value === "1";
  return (
    <>
      <span className="relative h-6 w-10 shrink-0">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.checked ? "1" : "0")}
          className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full bg-input transition-colors peer-checked:bg-primary peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-checked:[&>span]:translate-x-4"
        >
          <span className="absolute top-[3px] left-[3px] size-[18px] rounded-full bg-white shadow-xs transition-transform motion-reduce:transition-none" />
        </span>
      </span>
      <span className="text-[13px] text-muted-foreground">{displayValue(field, value === "" ? null : value)}</span>
    </>
  );
}

function StringControl({ id, value, describedBy, invalid, onChange }: FieldControlProps) {
  return (
    <Input
      id={id}
      type="text"
      autoComplete="off"
      value={value}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn(CONTROL_INPUT, "flex-1")}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function DateControl({ id, value, describedBy, invalid, onChange }: FieldControlProps) {
  return (
    <Input
      id={id}
      type="date"
      value={value}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={cn(CONTROL_INPUT, "flex-1")}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** A value that is a path: the directory it is in and the file name, or null when it is not one. */
function splitPath(value: string): { dir: string; name: string } | null {
  const at = value.lastIndexOf("/");
  if (!value.startsWith("/") || at <= 0 || at === value.length - 1) return null;
  return { dir: value.slice(0, at + 1), name: value.slice(at + 1) };
}

/** What a field is when it is shown and not changed: a dataset, a file, a list,
 *  a column, a block, a flag. The snapshot's value as it is; a path is its file
 *  name, large, over the directory it is in (the whole path is the tooltip). */
function ReadOnlyControl({ field, id, describedBy }: FieldControlProps) {
  const text = field.current;
  const path = text === null ? null : splitPath(text);
  return (
    <div
      id={id}
      aria-describedby={describedBy}
      title={path ? (text ?? undefined) : undefined}
      className="min-w-0 flex-1 rounded-lg bg-muted/50 px-2.5 py-1.5"
    >
      {text === null ? (
        <code className="block font-mono text-[12.5px] text-muted-foreground">Not set</code>
      ) : path ? (
        <>
          <code className="block truncate font-mono text-[12.5px] text-foreground">{path.name}</code>
          <span className="block truncate font-mono text-[11px] text-muted-foreground">{path.dir}</span>
        </>
      ) : (
        <code className="block font-mono text-[12.5px] break-all text-foreground">{text}</code>
      )}
    </div>
  );
}

/**
 * The one place a field's `type` picks its component. Types the wizard does not
 * change (dataset, file, list, column, block, flag) all show the current value.
 */
export const FIELD_CONTROLS: Record<FieldType, ComponentType<FieldControlProps>> = {
  number: NumberControl,
  int: NumberControl,
  enum: EnumControl,
  bool01: BoolControl,
  string: StringControl,
  date: DateControl,
  dataset: ReadOnlyControl,
  file: ReadOnlyControl,
  list: ReadOnlyControl,
  column: ReadOnlyControl,
  block: ReadOnlyControl,
  flag: ReadOnlyControl,
};

/** The control for a field: the editable one for a scalar the tree lets the
 *  wizard change, a choice among the model input's datasets (in the field's unit) for a dataset of a
 *  module being switched on, the read-only display for everything else. */
export function FieldControl(props: FieldControlProps) {
  const { field } = props;
  const Control = !isEditableField(field)
    ? ReadOnlyControl
    : hasCandidates(field)
      ? CandidateControl
      : FIELD_CONTROLS[valueType(field)];
  return <Control {...props} />;
}

const MUTED = "text-xs leading-normal text-muted-foreground";
const PILL = "rounded-full px-2 py-0.5 text-[11px] leading-none font-semibold";

function Range({ lo, hi, unit }: { lo: number | null; hi: number | null; unit: string | null }) {
  const u = unit ? ` ${unit}` : "";
  if (lo !== null && hi !== null) return <>{`${lo}–${hi}${u}`}</>;
  return <>{lo !== null ? `at least ${lo}${u}` : `at most ${hi}${u}`}</>;
}

/** A label with the occurrences of `query` marked, whatever their case. Plain text for no query.
 *  Found with `indexOf`, so nothing in the query is read as a pattern. */
function Highlighted({ text, query }: { text: string; query?: string }) {
  const needle = query?.trim().toLowerCase() ?? "";
  if (needle === "") return <>{text}</>;
  const haystack = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="rounded-sm bg-primary/15 text-foreground">
        {text.slice(at, at + needle.length)}
      </mark>
    );
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

/** The tree's help text, two lines of it with More when it is long. All of it stays in the page,
 *  so a screen reader (and `aria-describedby`) has it whole. */
function Doc({ id, text }: { id: string; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 140;
  return (
    <div className="mt-1">
      <p id={id} className={cn("text-[12.5px] leading-normal text-muted-foreground", long && !expanded && "line-clamp-2")}>
        {text}
      </p>
      {long && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
          className="mt-0.5 rounded text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {expanded ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

/** The range bar under a number with a calibration range: the band it usually stays in, a tick for
 *  the snapshot's value and a dot for the draft's (amber outside the band). It only draws; the
 *  same facts are in the text under it. */
function CalibrationBar({
  calibration,
  min,
  max,
  snapshot,
  current,
}: {
  calibration: [number, number];
  min: number | null;
  max: number | null;
  snapshot: string | null;
  current: string;
}) {
  const bar = calibrationBar(calibration, { min, max }, snapshot, current);
  const moved = bar.current !== null && bar.current !== bar.snapshot;
  return (
    <div aria-hidden="true" className="relative my-2 h-1.5 rounded-full bg-muted">
      <span
        className="absolute inset-y-0 rounded-full bg-primary/25"
        style={{ left: `${bar.band.left}%`, width: `${bar.band.width}%` }}
      />
      {bar.snapshot !== null && (
        <span
          data-mark="snapshot"
          className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/60"
          style={{ left: `${bar.snapshot}%` }}
        />
      )}
      {bar.current !== null && (moved || bar.outside) && (
        <span
          data-mark="current"
          className={cn(
            "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card",
            bar.outside ? "bg-warning" : "bg-primary"
          )}
          style={{ left: `${bar.current}%` }}
        />
      )}
    </div>
  );
}

/**
 * One parameter of the tree: its label and init key, the control its type names,
 * and around it the snapshot's value (once the draft changes it), WBM's default
 * when that differs, the calibration range and bounds, the tree's help text, when
 * it applies, and the backend's message. A changed value is marked and has a Reset,
 * which removes the key from `custom_params` (the snapshot's value comes back).
 *
 * `custom` is the draft's `custom_params`; the row reads its own key from it
 * and reports a new value (`onChange`) or a reset (`onReset`).
 *
 * A field the tree says is `forkable` that reads a data `.init` also has the Edit dataset panel
 * (`DatasetForkPanel`), which sets the values of the run's own copy of that descriptor: `fork` is
 * the draft's copy for this field and `onForkChange` reports a new one (null for none). The
 * panel needs `datasetId`, to show the original's values beside them.
 *
 * `advanced` marks a field of the advanced tier; `highlight` marks where a search text occurs in
 * the label.
 */
export function ParamFieldRow({
  field,
  custom,
  fork = null,
  datasetId,
  error,
  advanced = false,
  highlight,
  onChange,
  onReset,
  onForkChange,
}: {
  field: ParamField;
  custom: CustomParams | null;
  fork?: DatasetFork | null;
  datasetId?: string;
  /** The backend's message for this path. */
  error?: string | null;
  advanced?: boolean;
  highlight?: string;
  onChange: (value: string) => void;
  onReset: () => void;
  onForkChange?: (fork: DatasetFork | null) => void;
}) {
  const id = useId();
  const editable = isEditableField(field);
  const valueChanged = isChanged(field.path, custom);
  const changed = valueChanged || fork !== null;
  const constant = isConstantForDataset(field);
  const pickable = editable && hasCandidates(field);
  const unusable = (field.candidates ?? []).filter((c) => c.disabled !== null);
  const own = effectiveValue(field, custom) ?? "";
  // A dataset's value is a path, which a number box cannot hold: the box is empty until
  // the draft sets a constant.
  const value = constant && !valueChanged && !Number.isFinite(Number(own)) ? "" : own;
  const forkable = field.forkable === true && datasetId !== undefined && onForkChange !== undefined && isDataInit(own);
  // A dataset only a copy can use (WBM 23.9.0 refuses the file itself) is chosen with its copy.
  const repair = field.candidates?.find((c) => c.value === own)?.repair ?? null;
  const hasRange = field.min !== null || field.max !== null;
  const numeric = editable && !pickable && (valueType(field) === "number" || field.type === "int");
  const calibration = numeric ? field.calibration : null;
  const outside = calibration !== null && calibrationBar(calibration, { min: field.min, max: field.max }, field.current, value).outside;
  // The control shows the snapshot's value itself, unless the draft changed it or the box cannot hold it.
  const snapshotShown = valueChanged || value !== (field.current ?? "");
  const snapshot = displayValue(field, field.current);
  const ids = {
    facts: `${id}-facts`,
    doc: `${id}-doc`,
    when: `${id}-when`,
    error: `${id}-error`,
  };
  const describedBy =
    [ids.facts, field.doc ? ids.doc : null, field.show_if ? ids.when : null, error ? ids.error : null]
      .filter(Boolean)
      .join(" ") || undefined;

  // What goes in the line under the control, in this order.
  const facts: { key: string; node: ReactNode; tone?: "warning" }[] = [];
  if (snapshotShown) facts.push({ key: "snapshot", node: <>Snapshot: {snapshot}</> });
  if (!changed && defaultDiffers(field)) facts.push({ key: "default", node: <>WBM default: {displayValue(field, field.default)}</> });
  if (editable && hasRange) {
    facts.push({
      key: "allowed",
      node: (
        <>
          Allowed <Range lo={field.min} hi={field.max} unit={field.unit} />
        </>
      ),
    });
  }
  if (calibration) {
    facts.push({
      key: "calibration",
      node: (
        <>
          Usually calibrated within <Range lo={calibration[0]} hi={calibration[1]} unit={field.unit} />
        </>
      ),
    });
  }
  if (outside) facts.push({ key: "outside", node: <>Outside the usual calibration range</>, tone: "warning" });
  if (constant) facts.push({ key: "constant", node: <>A number replaces the dataset with a constant everywhere.</> });

  return (
    <div
      data-param-path={field.path}
      data-changed={changed || undefined}
      className={cn(
        "rounded-lg px-3 py-3",
        changed && "bg-primary/[0.035] shadow-[inset_2px_0_0_0_var(--color-primary)]"
      )}
    >
      <div className="grid gap-x-5 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,17rem)] sm:items-start">
        <div className={cn("min-w-0", forkable && "sm:row-span-2")}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {editable ? (
              <Label htmlFor={id} className="text-[13.5px] leading-snug font-semibold text-foreground">
                <span>
                  <Highlighted text={field.label} query={highlight} />
                </span>
              </Label>
            ) : (
              <span className="text-[13.5px] leading-snug font-semibold text-foreground">
                <Highlighted text={field.label} query={highlight} />
              </span>
            )}
            {changed && <span className={cn(PILL, "bg-primary/10 text-primary")}>Changed</span>}
            {!editable && (
              <span title="Read-only in the wizard" className="inline-flex items-center text-muted-foreground">
                <Lock aria-hidden="true" className="size-3.5" />
                <span className="sr-only">Read-only</span>
              </span>
            )}
            {pickable && field.required && value === "" && (
              <span className={cn(PILL, "bg-muted text-muted-foreground")}>Required</span>
            )}
            {advanced && (
              <span className={cn(PILL, "border border-border font-medium text-muted-foreground")}>Advanced</span>
            )}
          </div>
          <code className="mt-0.5 block font-mono text-[11px] leading-snug break-all text-muted-foreground">{field.path}</code>
          {field.doc && <Doc id={ids.doc} text={field.doc} />}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <FieldControl
              field={field}
              id={id}
              value={value}
              describedBy={describedBy}
              invalid={Boolean(error)}
              onChange={onChange}
            />
            {changed && (
              <button
                type="button"
                aria-label={`Reset ${field.label}`}
                title="Back to the snapshot's value"
                onClick={onReset}
                className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none sm:min-h-8 sm:min-w-8"
              >
                <RotateCcw aria-hidden="true" className="size-4" />
              </button>
            )}
          </div>
          {calibration && (
            <CalibrationBar
              calibration={calibration}
              min={field.min}
              max={field.max}
              snapshot={field.current}
              current={value}
            />
          )}
          {/* One fact a line: the column is narrow, and a wrapped "·" list starts lines with a dot. */}
          <p id={ids.facts} className={cn(MUTED, "mt-1.5 flex flex-col gap-y-0.5")}>
            {!snapshotShown && <span className="sr-only">In this snapshot: {snapshot}.</span>}
            {facts.map((fact) => (
              <span key={fact.key} className={cn(fact.tone === "warning" && "font-medium text-warning")}>
                {fact.node}
              </span>
            ))}
          </p>
        </div>

        {forkable && (
          <DatasetForkPanel
            datasetId={datasetId}
            path={field.path}
            original={own}
            fork={fork}
            repair={repair}
            error={error}
            closedClassName="sm:col-start-2"
            openClassName="sm:col-span-full"
            onChange={onForkChange}
          />
        )}
      </div>

      <div className="mt-2 space-y-1.5 empty:hidden">
        {pickable && unusable.length > 0 && (
          <details className={MUTED}>
            <summary className="cursor-pointer">
              {unusable.length === 1 ? "1 dataset cannot be used here" : `${unusable.length} datasets cannot be used here`}
            </summary>
            <ul className="mt-1 space-y-1">
              {unusable.map((c) => (
                <li key={c.value} className="break-words">
                  <span className="font-medium text-foreground">{c.name}</span>: {c.disabled}
                </li>
              ))}
            </ul>
          </details>
        )}
        {field.show_if && (
          <p id={ids.when} className={MUTED}>
            Applies when {field.show_if}
          </p>
        )}
        {error && (
          <p id={ids.error} className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
