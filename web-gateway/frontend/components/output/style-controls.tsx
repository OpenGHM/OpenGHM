"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNumber, type ViewState } from "@/lib/output/view";

export interface Legend {
  ramp: string;
  rampUsed: string;
  min: number;
  max: number;
  log: boolean;
  auto: boolean;
  colors: string[];
}

export const SELECT_CLASS =
  "h-9 min-w-0 rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-50";

/** The colour bar with its range and units, as the map was drawn. */
export function LegendBar({ legend, units }: { legend: Legend; units: string | null }) {
  return (
    <div className="flex flex-col gap-1" data-testid="output-legend">
      <div
        aria-hidden="true"
        className="h-3.5 w-full rounded-md border border-border"
        style={{ background: `linear-gradient(to right, ${legend.colors.join(", ")})` }}
      />
      <div className="flex items-baseline justify-between font-mono text-xs text-muted-foreground">
        <span>{formatNumber(legend.min)}</span>
        <span>
          {units ?? ""}
          {legend.log ? " · log scale" : ""}
          {legend.auto ? " · range of this map" : ""}
        </span>
        <span>{formatNumber(legend.max)}</span>
      </div>
    </div>
  );
}

type Patch = Partial<Pick<ViewState, "ramp" | "min" | "max" | "log">>;

/**
 * Ramp, range and log scale. Each is empty until chosen: the map is then drawn
 * as the run's MT says, and the fields show what it used. A number is applied
 * on Enter or when the field loses focus.
 */
export function StyleControls({
  ramps,
  legend,
  style,
  problem,
  onChange,
  onReset,
}: {
  ramps: string[];
  legend: Legend | null;
  style: Pick<ViewState, "ramp" | "min" | "max" | "log">;
  problem: string | null;
  onChange: (patch: Patch) => void;
  onReset: () => void;
}) {
  const changed = style.ramp !== null || style.min !== null || style.max !== null || style.log !== null;
  const offered = style.ramp && !ramps.includes(style.ramp) ? [style.ramp, ...ramps] : ramps;

  const number = (name: "min" | "max", label: string) => (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <Input
        // A new key makes the field start over, from a reset or a reopened link.
        key={`${name}-${style[name] ?? ""}`}
        inputMode="decimal"
        defaultValue={style[name] ?? ""}
        placeholder={legend ? formatNumber(legend[name]) : ""}
        aria-invalid={problem !== null && style[name] !== null}
        className="h-9 w-28 font-mono"
        onBlur={(event) => {
          const text = event.currentTarget.value.trim();
          const value = text === "" ? null : Number(text);
          if (value !== null && !Number.isFinite(value)) {
            event.currentTarget.value = String(style[name] ?? "");
            return;
          }
          if (value !== style[name]) onChange({ [name]: value });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Colour ramp
          <select
            className={SELECT_CLASS}
            value={style.ramp ?? ""}
            onChange={(event) => onChange({ ramp: event.target.value || null })}
          >
            <option value="">{legend ? `As the run: ${legend.ramp}` : "As the run"}</option>
            {offered.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        {number("min", "Minimum")}
        {number("max", "Maximum")}
        <label className="flex h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--primary)]"
            checked={style.log ?? legend?.log ?? false}
            onChange={(event) => onChange({ log: event.target.checked })}
          />
          Log scale
        </label>
        <Button type="button" variant="outline" size="sm" disabled={!changed} onClick={onReset} className="h-9">
          <RotateCcw aria-hidden="true" />
          Reset
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}
