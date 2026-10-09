"use client";

/** The filter widgets: what a group of `CATALOGUE_FILTER_GROUPS` is made of. `CatalogueFilterBody` picks one. */
import { useId, useMemo, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { facetOptionLabel } from "@/lib/repository/catalogue";
import { SPATIAL_RES_PRESETS } from "@/lib/repository/data";
import {
  RESOLUTION_UNITS,
  formatResolution,
  type ResolutionUnit,
} from "@/lib/repository/resolution";
import {
  EDGE_LABELS,
  REGION_EDGES,
  regionErrors,
  regionFromText,
  type RegionEdge,
} from "@/lib/repository/region";
import type {
  CatalogueFacetKey,
  CatalogueFacetOption,
  CatalogueFilterState,
} from "@/lib/repository/types";

/** A group lists this many options before "Show all". */
export const COLLAPSED_OPTION_COUNT = 6;

/** A control row is 40 px tall on a phone and tighter beside the results. */
const ROW = "min-h-10 lg:min-h-8";

/** The edge-less grey box of a typed value (a year, a limit of the region): mono, as in the design. */
const FIELD = "h-10 rounded-[10px] border-transparent bg-muted px-3 font-mono text-sm md:text-sm";

/** The unit buttons and preset chips: a pill that fills with the foreground when on. */
const PILL =
  "inline-flex h-10 items-center justify-center rounded-full border font-mono text-xs outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none lg:h-8";
const PILL_ON = "border-foreground bg-foreground text-background";
const PILL_OFF = "border-border bg-card text-foreground/80 hover:border-foreground";

/** The slider row is as tall as a control row, so the thumb has a touch target. */
const SLIDER_ROW = "h-10";

/**
 * A selected value the facets no longer list (a stale link, a failed fetch)
 * stays among the options so it can be cleared.
 */
function withSelected(options: CatalogueFacetOption[], selected: string[]): CatalogueFacetOption[] {
  const known = new Set(options.map((o) => o.value));
  const extra = selected
    .filter((v) => !known.has(v))
    .map((value) => ({ value, label: value, count: 0 }));
  return [...options, ...extra];
}

/**
 * A checkbox row: a real, visually hidden checkbox (so it keeps its name, its
 * keyboard and its focus) and a drawn box beside the label. `trailing` is the
 * count pill.
 */
function FilterCheckbox({
  checked,
  onChange,
  trailing,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label
      className={cn(
        "-mx-2.5 flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 text-sm text-foreground hover:bg-muted/70",
        ROW
      )}
    >
      <input type="checkbox" checked={checked} onChange={onChange} className="peer sr-only" />
      <span
        aria-hidden="true"
        className="grid size-[18px] shrink-0 place-items-center rounded-md border-[1.5px] border-input bg-card text-white transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 motion-reduce:transition-none [&>svg]:hidden peer-checked:[&>svg]:block"
      >
        <Check className="size-3" strokeWidth={3} />
      </span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
      {trailing}
    </label>
  );
}

// ─── A checkbox list with a count per option ─────────────────────────────────

/** A facet group's body: one checkbox per option. */
export function FacetCheckboxList({
  facetKey,
  options,
  selected,
  onChange,
}: {
  facetKey: CatalogueFacetKey;
  options: CatalogueFacetOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const all = useMemo(() => withSelected(options, selected), [options, selected]);

  const collapsible = all.length > COLLAPSED_OPTION_COUNT;
  const visible =
    expanded || !collapsible
      ? all
      : all.filter((o, i) => i < COLLAPSED_OPTION_COUNT || selected.includes(o.value));

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <div>
      <ul className="space-y-px">
        {visible.map((o) => {
          const checked = selected.includes(o.value);
          return (
            <li key={o.value}>
              <FilterCheckbox
                checked={checked}
                onChange={() => toggle(o.value)}
                trailing={
                  <>
                    {" "}
                    {!Number.isNaN(o.count) && (
                      <span
                        className={cn(
                          "shrink-0 rounded-full bg-muted px-[7px] py-px font-mono text-[11.5px] tabular-nums",
                          o.count === 0 && !checked
                            ? "text-muted-foreground/70"
                            : "text-muted-foreground"
                        )}
                      >
                        {o.count}
                      </span>
                    )}
                  </>
                }
              >
                {facetOptionLabel(facetKey, o.value, o.label)}
              </FilterCheckbox>
            </li>
          );
        })}
      </ul>
      {collapsible && (
        <Button
          type="button"
          variant="link"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 h-10 px-1 lg:h-8"
        >
          {expanded ? "Show fewer" : `Show all (${all.length})`}
        </Button>
      )}
    </div>
  );
}

/**
 * The Type group's body: the kinds side by side as a segmented control, each
 * with its count. Like the checkboxes it replaces, any of them can be on at
 * once, and none means no filter.
 */
export function FacetSegmentedControl({
  facetKey,
  options,
  selected,
  onChange,
}: {
  facetKey: CatalogueFacetKey;
  options: CatalogueFacetOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const all = useMemo(() => withSelected(options, selected), [options, selected]);
  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1.5 rounded-[14px] bg-muted p-1">
      {all.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(o.value)}
            className={cn(
              "flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-[10px] px-1.5 py-1.5 text-[12.5px] leading-tight font-semibold outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none",
              on ? "bg-hero text-white" : "text-foreground/80 hover:bg-card"
            )}
          >
            {facetOptionLabel(facetKey, o.value, o.label)}{" "}
            {!Number.isNaN(o.count) && (
              <span
                className={cn(
                  "font-mono text-[11px] font-normal",
                  on ? "text-hero-eyebrow" : "text-muted-foreground"
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Temporal coverage: a dual-handle slider with From / To boxes ────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function YearInput({
  id,
  label,
  value,
  min,
  max,
  disabled,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onCommit: (year: number) => void;
}) {
  const [text, setText] = useState(String(value));
  // The slider, a preset or Clear all changed the value: show it.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(String(value));
  }

  // Typing is free; the value is read, clamped and applied on blur or Enter.
  const commit = () => {
    const n = parseInt(text, 10);
    if (Number.isNaN(n)) {
      setText(String(value));
      return;
    }
    const year = clamp(n, min, max);
    setText(String(year));
    if (year !== value) onCommit(year);
  };

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        className={cn(FIELD, "text-center")}
      />
    </div>
  );
}

/** The temporal group's body. */
export function YearRangeFilter({
  bounds,
  start,
  end,
  onChange,
}: {
  bounds: { min: number; max: number };
  start: number | null;
  end: number | null;
  onChange: (updates: Pick<CatalogueFilterState, "yearStart" | "yearEnd">) => void;
}) {
  const lo = clamp(start ?? bounds.min, bounds.min, bounds.max);
  const hi = clamp(end ?? bounds.max, bounds.min, bounds.max);
  // While a handle is dragged the slider moves at once and the filter applies
  // on release. A keyboard step reports its commit before its change, so the
  // draft remembers the filter it was made against and is dropped as soon as
  // the filter is no longer that one (the URL caught up, or Reset).
  const [dragged, setDragged] = useState<{
    values: [number, number];
    start: number | null;
    end: number | null;
  } | null>(null);
  const stale = dragged !== null && (dragged.start !== start || dragged.end !== end);
  if (stale) setDragged(null);
  const draft = stale ? null : (dragged?.values ?? null);
  const shown = draft ?? [lo, hi];
  const disabled = bounds.min >= bounds.max;

  // A range that spans all the years is "no filter".
  const commit = (a: number, b: number) =>
    onChange({
      yearStart: a <= bounds.min ? null : a,
      yearEnd: b >= bounds.max ? null : b,
    });

  // Ids of its own: the picker has this control in its panel and in its dialog at once.
  const inputId = useId();
  return (
    <div className="space-y-2">
      <Slider
        min={bounds.min}
        max={bounds.max}
        step={1}
        value={shown}
        disabled={disabled}
        thumbLabels={["Earliest year", "Latest year"]}
        onValueChange={([a, b]) => setDragged({ values: [a, b], start, end })}
        onValueCommit={([a, b]) => {
          setDragged(null);
          commit(a, b);
        }}
        className={SLIDER_ROW}
      />
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <YearInput
          id={`${inputId}-from`}
          label="From"
          value={shown[0]}
          min={bounds.min}
          max={bounds.max}
          disabled={disabled}
          onCommit={(year) => commit(year, Math.max(year, shown[1]))}
        />
        <span aria-hidden="true" className="text-muted-foreground/70">
          →
        </span>
        <YearInput
          id={`${inputId}-to`}
          label="To"
          value={shown[1]}
          min={bounds.min}
          max={bounds.max}
          disabled={disabled}
          onCommit={(year) => commit(Math.min(year, shown[0]), year)}
        />
      </div>
    </div>
  );
}

// ─── Spatial resolution: preset chips, All, a unit and a range slider ────────

/** The slider spans 0 to 2 degrees; both handles at the ends mean "no filter". */
const RES_SLIDER = { min: 0, max: 2, step: 0.001 };

/** The resolution group's body: the common resolutions as chips, then the exact range. */
export function ResolutionFilter({
  min,
  max,
  onChange,
}: {
  min: number | null;
  max: number | null;
  onChange: (updates: Pick<CatalogueFilterState, "spatialResMin" | "spatialResMax">) => void;
}) {
  // The unit is only how the numbers are written, so it stays out of the URL.
  const [unit, setUnit] = useState<ResolutionUnit>("deg");
  // While a handle is dragged the slider moves at once and the filter applies
  // on release. A keyboard step reports its commit before its change, so the
  // draft remembers the filter it was made against and is dropped as soon as
  // the filter is no longer that one.
  const [dragged, setDragged] = useState<{ values: [number, number]; min: number | null; max: number | null } | null>(null);
  const stale = dragged !== null && (dragged.min !== min || dragged.max !== max);
  if (stale) setDragged(null);
  const draft = stale ? null : (dragged?.values ?? null);
  const unitLabelId = useId();

  const none = min === null && max === null;
  const [lo, hi]: [number, number] =
    draft ?? [min ?? RES_SLIDER.min, max ?? RES_SLIDER.max];
  const showingAll = draft
    ? draft[0] <= RES_SLIDER.min && draft[1] >= RES_SLIDER.max
    : none;

  const commit = (a: number, b: number) =>
    onChange(
      a <= RES_SLIDER.min && b >= RES_SLIDER.max
        ? { spatialResMin: null, spatialResMax: null }
        : { spatialResMin: a, spatialResMax: b }
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {SPATIAL_RES_PRESETS.map((p) => {
          const active = lo === p.degrees && hi === p.degrees;
          return (
            <button
              key={p.label}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setDragged(null);
                onChange(
                  active
                    ? { spatialResMin: null, spatialResMax: null }
                    : { spatialResMin: p.degrees, spatialResMax: p.degrees }
                );
              }}
              className={cn(PILL, "px-3", active ? PILL_ON : PILL_OFF)}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="space-y-2">
        <FilterCheckbox
          checked={showingAll}
          // "All" is the state with no range: ticking it clears one, and
          // unticking it has nothing to do until a range is chosen.
          onChange={() => {
            if (!none) onChange({ spatialResMin: null, spatialResMax: null });
          }}
        >
          All
        </FilterCheckbox>

        <div className="flex items-center gap-2">
          <span id={unitLabelId} className="text-xs text-muted-foreground">
            Unit
          </span>
          <div role="group" aria-labelledby={unitLabelId} className="flex gap-1">
            {RESOLUTION_UNITS.map((u) => {
              const active = unit === u.value;
              return (
                <button
                  key={u.value}
                  type="button"
                  aria-pressed={active}
                  aria-label={u.label}
                  title={u.label}
                  onClick={() => setUnit(u.value)}
                  className={cn(PILL, "min-w-10 text-sm lg:min-w-8", active ? PILL_ON : PILL_OFF)}
                >
                  <span aria-hidden="true">{u.symbol}</span>
                </button>
              );
            })}
          </div>
        </div>

        <Slider
          min={RES_SLIDER.min}
          max={RES_SLIDER.max}
          step={RES_SLIDER.step}
          value={[lo, hi]}
          thumbLabels={["Finest resolution", "Coarsest resolution"]}
          onValueChange={([a, b]) => setDragged({ values: [a, b], min, max })}
          onValueCommit={([a, b]) => {
            setDragged(null);
            commit(a, b);
          }}
          className={SLIDER_ROW}
        />
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs text-muted-foreground">
          <span className={cn("min-w-0 truncate", !showingAll && "font-mono tabular-nums text-foreground")}>
            {showingAll ? "finest" : formatResolution(lo, unit)}
          </span>
          <span aria-hidden="true" className="text-[11px] text-muted-foreground">
            Fine ← → Coarse
          </span>
          <span
            className={cn(
              "min-w-0 truncate text-right",
              !showingAll && "font-mono tabular-nums text-foreground"
            )}
          >
            {showingAll ? "coarsest" : formatResolution(hi, unit)}
          </span>
        </div>
      </div>
    </div>
  );
}


// ─── Region: four numeric edges of a bounding box ────────────────────────────

type BoxKeys = Pick<CatalogueFilterState, "boxNorth" | "boxSouth" | "boxEast" | "boxWest">;

const NO_BOX: BoxKeys = { boxNorth: null, boxSouth: null, boxEast: null, boxWest: null };

const EDGE_PLACEHOLDERS: Record<RegionEdge, string> = {
  north: "e.g. 45",
  south: "e.g. 40",
  west: "e.g. -110",
  east: "e.g. -100",
};

/**
 * The region group's body: North, South, West and East in decimal degrees. The
 * filter is set only while all four are valid, and cleared as soon as one is
 * not, so the list never stays filtered by a box the fields no longer show. The
 * text is the control's own (typing "-" on the way to "-110" is not a value);
 * a box that arrives from outside (a link, the back button, Reset) replaces it.
 */
export function RegionFilter({
  north,
  south,
  east,
  west,
  onChange,
}: {
  north: number | null;
  south: number | null;
  east: number | null;
  west: number | null;
  onChange: (updates: BoxKeys) => void;
}) {
  const idBase = useId();
  const fromProps = (): Record<RegionEdge, string> => ({
    north: north === null ? "" : String(north),
    south: south === null ? "" : String(south),
    west: west === null ? "" : String(west),
    east: east === null ? "" : String(east),
  });
  const [text, setText] = useState(fromProps);
  const [focused, setFocused] = useState<RegionEdge | null>(null);

  const propsKey = [north, south, east, west].join("|");
  const [seen, setSeen] = useState(propsKey);
  if (seen !== propsKey) {
    setSeen(propsKey);
    // What this control sent comes back as the box its text makes, or as no box
    // while its text is incomplete; anything else came from outside.
    const own = regionFromText(text);
    const ours = own
      ? own.north === north && own.south === south && own.east === east && own.west === west
      : north === null && south === null && east === null && west === null;
    if (!ours) setText(fromProps());
  }

  const active = north !== null || south !== null || east !== null || west !== null;
  const errors = regionErrors(text);
  const anyText = REGION_EDGES.some((e) => text[e].trim() !== "");

  const edit = (edge: RegionEdge, value: string) => {
    const next = { ...text, [edge]: value };
    setText(next);
    const box = regionFromText(next);
    if (box) {
      if (
        box.north !== north ||
        box.south !== south ||
        box.east !== east ||
        box.west !== west
      ) {
        onChange({ boxNorth: box.north, boxSouth: box.south, boxEast: box.east, boxWest: box.west });
      }
    } else if (active) {
      onChange(NO_BOX);
    }
  };

  const clear = () => {
    setText({ north: "", south: "", west: "", east: "" });
    if (active) onChange(NO_BOX);
  };

  const hintId = `${idBase}-hint`;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {REGION_EDGES.map((edge) => {
          const id = `${idBase}-${edge}`;
          const message = focused === edge ? null : (errors[edge] ?? null);
          const invalid = errors[edge] !== undefined;
          return (
            <div key={edge} className="min-w-0">
              <label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">
                {EDGE_LABELS[edge]}
              </label>
              <Input
                id={id}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder={EDGE_PLACEHOLDERS[edge]}
                value={text[edge]}
                aria-invalid={invalid || undefined}
                aria-describedby={message ? `${id}-error` : hintId}
                onChange={(e) => edit(edge, e.target.value)}
                onFocus={() => setFocused(edge)}
                onBlur={() => setFocused((f) => (f === edge ? null : f))}
                className={FIELD}
              />
              {message && (
                <p id={`${id}-error`} className="mt-1 text-xs text-destructive">
                  {message}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        Decimal degrees (EPSG:4326). Matches anything whose coverage overlaps the box, edges
        included. Applies once all four are valid; West above East crosses the antimeridian.
      </p>
      {anyText && (
        <Button type="button" variant="ghost" size="sm" onClick={clear} className="h-8 px-2">
          Clear region
        </Button>
      )}
    </div>
  );
}
