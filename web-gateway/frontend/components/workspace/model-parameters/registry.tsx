"use client";

import { useId, type ComponentType } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  defaultDiffers,
  displayValue,
  effectiveValue,
  isChanged,
  isConstantForDataset,
  isEditableField,
  valueType,
  type CustomParams,
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

const CONTROL_INPUT = "h-10 font-mono md:text-sm";

/** A number, or an integer (`step` 1: the browser flags a fraction). `min` and
 *  `max` are the tree's; the unit sits after the box. */
function NumberControl({ field, id, value, describedBy, invalid, onChange }: FieldControlProps) {
  return (
    <>
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
        className={cn(CONTROL_INPUT, "min-w-0 flex-1")}
        onChange={(e) => onChange(e.target.value)}
      />
      {field.unit && <span className="shrink-0 text-[13px] text-muted-foreground">{field.unit}</span>}
    </>
  );
}

const SELECT =
  "h-10 min-w-0 flex-1 rounded-xl border border-input bg-card px-3 text-base outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

/** A choice, with the tree's labels. A value that is not among the options (an
 *  init that holds something else) is listed as it is, so the select shows it. */
function EnumControl({ field, id, value, describedBy, invalid, onChange }: FieldControlProps) {
  const options = field.options ?? [];
  const listed = options.some((o) => o.value === value);
  return (
    <select
      id={id}
      value={value}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={SELECT}
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
    </select>
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
      className={cn(CONTROL_INPUT, "min-w-0 flex-1")}
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
      className={cn(CONTROL_INPUT, "min-w-0 flex-1")}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** What a field is when it is shown and not changed: a dataset, a file, a list,
 *  a column, a block, a flag. The snapshot's value as it is. */
function ReadOnlyControl({ field, id, describedBy }: FieldControlProps) {
  return (
    <code
      id={id}
      aria-describedby={describedBy}
      className="min-w-0 flex-1 break-all font-mono text-[12.5px] text-foreground"
    >
      {field.current ?? "Not set"}
    </code>
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
 *  wizard change, the read-only display for everything else. */
export function FieldControl(props: FieldControlProps) {
  const Control = isEditableField(props.field) ? FIELD_CONTROLS[valueType(props.field)] : ReadOnlyControl;
  return <Control {...props} />;
}

const MUTED = "text-xs leading-normal text-muted-foreground";

function Range({ lo, hi, unit }: { lo: number | null; hi: number | null; unit: string | null }) {
  const u = unit ? ` ${unit}` : "";
  if (lo !== null && hi !== null) return <>{`${lo}–${hi}${u}`}</>;
  return <>{lo !== null ? `at least ${lo}${u}` : `at most ${hi}${u}`}</>;
}

/**
 * One parameter of the tree: its label and init key, the control its type names,
 * and under it the snapshot's value, WBM's default when that differs, the
 * calibration range and bounds, the tree's help text, when it applies, and the
 * backend's message. A changed value is marked and has a Reset, which removes
 * the key from `custom_params` (the snapshot's value comes back).
 *
 * `custom` is the draft's `custom_params`; the row reads its own key from it
 * and reports a new value (`onChange`) or a reset (`onReset`).
 */
export function ParamFieldRow({
  field,
  custom,
  error,
  onChange,
  onReset,
}: {
  field: ParamField;
  custom: CustomParams | null;
  /** The backend's message for this path. */
  error?: string | null;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  const id = useId();
  const editable = isEditableField(field);
  const changed = isChanged(field.path, custom);
  const constant = isConstantForDataset(field);
  const own = effectiveValue(field, custom) ?? "";
  // A dataset's value is a path, which a number box cannot hold: the box is empty until
  // the draft sets a constant.
  const value = constant && !isChanged(field.path, custom) && !Number.isFinite(Number(own)) ? "" : own;
  const hasRange = field.min !== null || field.max !== null;
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

  return (
    <div
      data-param-path={field.path}
      data-changed={changed || undefined}
      className={cn("space-y-1.5 border-l-2 py-3 pl-3.5", changed ? "border-primary" : "border-transparent")}
    >
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,17rem)] sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {editable ? (
              <Label htmlFor={id} className="text-[13.5px] leading-snug font-semibold text-foreground">
                {field.label}
              </Label>
            ) : (
              <span className="text-[13.5px] leading-snug font-semibold text-foreground">{field.label}</span>
            )}
            {changed && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                Changed
              </span>
            )}
            {!editable && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                Read-only
              </span>
            )}
          </div>
          <code className="block font-mono text-[11.5px] break-all text-muted-foreground">{field.path}</code>
        </div>
        <div className="flex min-w-0 items-center gap-2">
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
              onClick={onReset}
              className="inline-flex min-h-10 shrink-0 items-center rounded px-1.5 text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      <p id={ids.facts} className={MUTED}>
        <span>In this snapshot: {displayValue(field, field.current)}</span>
        {defaultDiffers(field) && <span>{` · WBM's default: ${displayValue(field, field.default)}`}</span>}
        {field.calibration && (
          <span>
            {" · Usually calibrated within "}
            <Range lo={field.calibration[0]} hi={field.calibration[1]} unit={field.unit} />
          </span>
        )}
        {constant && (
          <span>
            {" · Entering a number replaces the dataset with that constant for every grid cell."}
          </span>
        )}
        {editable && hasRange && (
          <span>
            {" · Allowed: "}
            <Range lo={field.min} hi={field.max} unit={field.unit} />
          </span>
        )}
      </p>
      {field.doc && (
        <p id={ids.doc} className="text-[13px] leading-normal text-muted-foreground">
          {field.doc}
        </p>
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
  );
}
