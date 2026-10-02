"use client";

import { useId, useMemo, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  CATALOGUE_FACET_NAMES,
  countActiveFilters,
  facetOptionLabel,
  hasActiveFilters,
} from "@/lib/repository/catalogue";
import { SPATIAL_RES_PRESETS, TEMPORAL_RANGE_BOUNDS } from "@/lib/repository/data";
import {
  RESOLUTION_UNITS,
  formatResolution,
  type ResolutionUnit,
} from "@/lib/repository/resolution";
import type {
  CatalogueFacetKey,
  CatalogueFacetOption,
  CatalogueFacets,
  CatalogueFilterState,
} from "@/lib/repository/types";
import { FilterGroup } from "./filter-group";

/** A group lists this many options before "Show all". */
const COLLAPSED_OPTION_COUNT = 6;

/** What the Type group offers when the facets could not be loaded. */
const TYPE_FALLBACK: CatalogueFacetOption[] = [
  { value: "snapshot", label: "Model Snapshot", count: NaN },
  { value: "model-input", label: "Model Input", count: NaN },
];

/** A control row is 40 px tall on a phone and tighter beside the results. */
const ROW = "min-h-10 lg:min-h-8";

// ─── A checkbox list with a count per option ─────────────────────────────────

function FacetCheckboxList({
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

  // A selected value the facets no longer list (a stale link, a failed fetch)
  // stays visible so it can be unticked.
  const all = useMemo(() => {
    const known = new Set(options.map((o) => o.value));
    const extra = selected
      .filter((v) => !known.has(v))
      .map((value) => ({ value, label: value, count: 0 }));
    return [...options, ...extra];
  }, [options, selected]);

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
              <label
                className={cn(
                  "-mx-2 flex cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm text-foreground hover:bg-muted/60",
                  ROW
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(o.value)}
                  className="size-4 shrink-0 rounded border-border accent-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
                <span className="min-w-0 flex-1 break-words">
                  {facetOptionLabel(facetKey, o.value, o.label)}
                </span>
                {" "}
                {!Number.isNaN(o.count) && (
                  <span
                    className={cn(
                      "shrink-0 font-mono text-xs tabular-nums",
                      o.count === 0 && !checked
                        ? "text-muted-foreground/70"
                        : "text-muted-foreground"
                    )}
                  >
                    {o.count}
                  </span>
                )}
              </label>
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
      <label htmlFor={id} className="mb-1 block text-xs text-muted-foreground">
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
        className="h-10 rounded-lg border-border bg-input px-2.5 font-mono text-[13.5px] md:text-[13.5px] lg:h-9"
      />
    </div>
  );
}

/** Also the snapshot picker's temporal filter (`workspace/snapshot-picker-filters.tsx`). */
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
        className="h-10"
      />
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <YearInput
          id="catalogue-year-from"
          label="From"
          value={shown[0]}
          min={bounds.min}
          max={bounds.max}
          disabled={disabled}
          onCommit={(year) => commit(year, Math.max(year, shown[1]))}
        />
        <span aria-hidden="true" className="pb-2 text-muted-foreground/70 lg:pb-1.5">
          –
        </span>
        <YearInput
          id="catalogue-year-to"
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

// ─── Spatial resolution: All, a unit, a range slider and preset chips ────────

/** The slider spans 0 to 2 degrees; both handles at the ends mean "no filter". */
const RES_SLIDER = { min: 0, max: 2, step: 0.001 };

/** The unit buttons and preset chips share this focus and motion recipe. */
const TOGGLE_FOCUS =
  "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none";

/** Also the snapshot picker's resolution filter. */
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
    <div className="space-y-2">
      <label
        className={cn(
          "-mx-2 flex cursor-pointer items-center gap-2.5 rounded-lg px-2 text-sm text-foreground hover:bg-muted/60",
          ROW
        )}
      >
        <input
          type="checkbox"
          checked={showingAll}
          // "All" is the state with no range: ticking it clears one, and
          // unticking it has nothing to do until a range is chosen.
          onChange={() => {
            if (!none) onChange({ spatialResMin: null, spatialResMax: null });
          }}
          className="size-4 shrink-0 rounded border-border accent-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <span className="min-w-0 flex-1">All</span>
      </label>

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
                className={cn(
                  "inline-flex h-10 min-w-10 items-center justify-center rounded-lg border font-mono text-sm transition-colors lg:h-8 lg:min-w-8",
                  TOGGLE_FOCUS,
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-foreground/80 hover:border-foreground/30"
                )}
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
        className="h-10"
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

      <div className="flex flex-wrap gap-1.5 pt-1">
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
              className={cn(
                "inline-flex h-10 items-center rounded-full border px-3 font-mono text-xs transition-colors lg:h-8",
                TOGGLE_FOCUS,
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-foreground/80 hover:border-foreground/30"
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── The sidebar ─────────────────────────────────────────────────────────────

type GroupSpec =
  | { kind: "facet"; key: CatalogueFacetKey; defaultOpen: boolean | "when-short"; shortAtMost?: number }
  | { kind: "temporal"; defaultOpen: boolean }
  | { kind: "resolution"; defaultOpen: boolean };

/** The order of the groups, top to bottom. */
const GROUPS: GroupSpec[] = [
  { kind: "facet", key: "type", defaultOpen: true },
  // The closed tag list is short: open unless it has grown past eight options.
  { kind: "facet", key: "tag", defaultOpen: "when-short", shortAtMost: 8 },
  // Open only when the whole list fits without "Show all".
  { kind: "facet", key: "keyword", defaultOpen: "when-short" },
  { kind: "temporal", defaultOpen: true },
  { kind: "resolution", defaultOpen: true },
  { kind: "facet", key: "output", defaultOpen: false },
  { kind: "facet", key: "forcing", defaultOpen: false },
  { kind: "facet", key: "wbm", defaultOpen: false },
  { kind: "facet", key: "process", defaultOpen: false },
  { kind: "facet", key: "creator", defaultOpen: false },
  { kind: "facet", key: "license", defaultOpen: false },
];

export function CatalogueSidebar({
  filters,
  facets,
  onChange,
  onClearAll,
}: {
  filters: CatalogueFilterState;
  facets: CatalogueFacets;
  onChange: (updates: Partial<CatalogueFilterState>) => void;
  onClearAll: () => void;
}) {
  // Below lg the panel is folded behind a "Filters" button; from lg it is always open.
  const [panelOpen, setPanelOpen] = useState(false);
  const activeCount = countActiveFilters(filters);
  const anyActive = hasActiveFilters(filters);
  const yearBounds = facets.yearBounds ?? TEMPORAL_RANGE_BOUNDS;

  return (
    <aside aria-label="Filters" className="w-full lg:w-[260px] lg:shrink-0">
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          variant="outline"
          aria-expanded={panelOpen}
          aria-controls="catalogue-filters-panel"
          onClick={() => setPanelOpen((o) => !o)}
          className="h-11 w-full justify-between rounded-xl bg-card hover:bg-muted hover:text-foreground lg:hidden"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal aria-hidden="true" />
            Filters
            {activeCount > 0 && (
              <Badge className="bg-highlight/10 text-highlight">
                <span aria-hidden="true">{activeCount}</span>
                <span className="sr-only">{activeCount} active</span>
              </Badge>
            )}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn("motion-safe:transition-transform", panelOpen && "rotate-180")}
          />
        </Button>

        <Card
          id="catalogue-filters-panel"
          className={cn(
            "gap-0 overflow-hidden rounded-2xl border py-0 shadow-none lg:flex",
            panelOpen ? "flex" : "hidden"
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 sm:px-[18px]">
            <h2 className="text-[15px] font-semibold text-foreground">Filters</h2>
            {anyActive && (
              <button
                type="button"
                onClick={onClearAll}
                className="inline-flex min-h-10 items-center rounded-md px-1 text-[13px] text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-8"
              >
                Reset
              </button>
            )}
          </div>

          <div>
            {GROUPS.map((group) => {
              if (group.kind === "temporal") {
                return (
                  <FilterGroup
                    key="temporal"
                    title="Temporal coverage"
                    defaultOpen={group.defaultOpen}
                    activeCount={filters.yearStart !== null || filters.yearEnd !== null ? 1 : 0}
                  >
                    <YearRangeFilter
                      bounds={yearBounds}
                      start={filters.yearStart}
                      end={filters.yearEnd}
                      onChange={onChange}
                    />
                  </FilterGroup>
                );
              }
              if (group.kind === "resolution") {
                return (
                  <FilterGroup
                    key="resolution"
                    title="Spatial resolution"
                    defaultOpen={group.defaultOpen}
                    activeCount={
                      filters.spatialResMin !== null || filters.spatialResMax !== null ? 1 : 0
                    }
                  >
                    <ResolutionFilter
                      min={filters.spatialResMin}
                      max={filters.spatialResMax}
                      onChange={onChange}
                    />
                  </FilterGroup>
                );
              }

              const { key } = group;
              const selected = filters[key];
              const options = facets[key].length === 0 && key === "type" ? TYPE_FALLBACK : facets[key];
              if (options.length === 0 && selected.length === 0) return null;
              return (
                <FilterGroup
                  key={key}
                  title={CATALOGUE_FACET_NAMES[key].title}
                  defaultOpen={
                    group.defaultOpen === "when-short"
                      ? options.length <= (group.shortAtMost ?? COLLAPSED_OPTION_COUNT)
                      : group.defaultOpen
                  }
                  activeCount={selected.length}
                >
                  <FacetCheckboxList
                    facetKey={key}
                    options={options}
                    selected={selected}
                    onChange={(next) => onChange({ [key]: next })}
                  />
                </FilterGroup>
              );
            })}
          </div>
        </Card>
      </div>
    </aside>
  );
}
