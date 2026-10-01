"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
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

type SpatialUnit = "deg" | "arcmin" | "arcsec";

const UNIT_OPTIONS: { value: SpatialUnit; label: string; symbol: string; multiplier: number }[] = [
  { value: "deg", label: "Degrees", symbol: "°", multiplier: 1 },
  { value: "arcmin", label: "Arc-minutes", symbol: "′", multiplier: 60 },
  { value: "arcsec", label: "Arc-seconds", symbol: "″", multiplier: 3600 },
];

const RES_SLIDER = { min: 0, max: 2, step: 0.001 };

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
      <ul className="space-y-0.5">
        {visible.map((o) => {
          const checked = selected.includes(o.value);
          return (
            <li key={o.value}>
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-md px-1 text-sm text-foreground hover:bg-muted/60",
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
                      "shrink-0 text-xs tabular-nums",
                      o.count === 0 && !checked
                        ? "text-muted-foreground/70"
                        : "text-muted-foreground"
                    )}
                  >
                    ({o.count})
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
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">
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
        className="h-10 lg:h-9"
      />
    </div>
  );
}

function YearRangeFilter({
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
  // While a handle is dragged the slider moves at once and the filter applies on release.
  const [draft, setDraft] = useState<[number, number] | null>(null);
  const shown = draft ?? [lo, hi];
  const disabled = bounds.min >= bounds.max;

  // A range that spans all the years is "no filter".
  const commit = (a: number, b: number) =>
    onChange({
      yearStart: a <= bounds.min ? null : a,
      yearEnd: b >= bounds.max ? null : b,
    });

  return (
    <div className="space-y-3">
      <Slider
        min={bounds.min}
        max={bounds.max}
        step={1}
        value={shown}
        disabled={disabled}
        thumbLabels={["Earliest year", "Latest year"]}
        onValueChange={([a, b]) => setDraft([a, b])}
        onValueCommit={([a, b]) => {
          setDraft(null);
          commit(a, b);
        }}
        className="h-10"
      />
      <div className="grid grid-cols-2 gap-3">
        <YearInput
          id="catalogue-year-from"
          label="From"
          value={shown[0]}
          min={bounds.min}
          max={bounds.max}
          disabled={disabled}
          onCommit={(year) => commit(year, Math.max(year, shown[1]))}
        />
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

// ─── Spatial resolution: slider, unit toggle and preset chips ────────────────

function ResolutionFilter({
  min,
  max,
  onChange,
}: {
  min: number | null;
  max: number | null;
  onChange: (updates: Pick<CatalogueFilterState, "spatialResMin" | "spatialResMax">) => void;
}) {
  const [unitValue, setUnitValue] = useState<SpatialUnit>("deg");
  const [draft, setDraft] = useState<[number, number] | null>(null);
  const unit = UNIT_OPTIONS.find((u) => u.value === unitValue)!;
  const unset = min === null && max === null;

  const lo = clamp(min ?? RES_SLIDER.min, RES_SLIDER.min, RES_SLIDER.max);
  const hi = clamp(max ?? RES_SLIDER.max, RES_SLIDER.min, RES_SLIDER.max);
  const shown = draft ?? [lo, hi];
  const showingAll = draft === null && unset;

  const fmt = (v: number) => {
    const converted = v * unit.multiplier;
    if (unit.value === "deg") return `${converted.toFixed(converted < 0.1 ? 4 : 2)}${unit.symbol}`;
    if (unit.value === "arcmin") return `${converted.toFixed(1)}${unit.symbol}`;
    return `${Math.round(converted)}${unit.symbol}`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground" id="catalogue-res-unit-label">
          Unit
        </span>
        <div className="flex gap-1" role="group" aria-labelledby="catalogue-res-unit-label">
          {UNIT_OPTIONS.map((u) => (
            <button
              key={u.value}
              type="button"
              aria-pressed={unitValue === u.value}
              aria-label={u.label}
              title={u.label}
              onClick={() => setUnitValue(u.value)}
              className={cn(
                "inline-flex h-10 min-w-10 items-center justify-center rounded-md px-2 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:h-8 lg:min-w-8",
                unitValue === u.value
                  ? "bg-primary font-medium text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              {u.symbol}
            </button>
          ))}
        </div>
      </div>

      <Slider
        min={RES_SLIDER.min}
        max={RES_SLIDER.max}
        step={RES_SLIDER.step}
        value={shown}
        thumbLabels={["Finest resolution", "Coarsest resolution"]}
        onValueChange={([a, b]) => setDraft([a, b])}
        onValueCommit={([a, b]) => {
          setDraft(null);
          const atMin = a <= RES_SLIDER.min;
          const atMax = b >= RES_SLIDER.max;
          onChange({
            spatialResMin: atMin && atMax ? null : a,
            spatialResMax: atMin && atMax ? null : b,
          });
        }}
        className="h-10"
      />
      <div className="flex justify-between gap-2 text-xs text-muted-foreground">
        <span>{showingAll ? "finest" : fmt(shown[0])}</span>
        <span aria-hidden="true" className="text-muted-foreground/70">
          Fine ← → Coarse
        </span>
        <span>{showingAll ? "coarsest" : fmt(shown[1])}</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SPATIAL_RES_PRESETS.map((p) => {
          const active = min === p.degrees && max === p.degrees;
          return (
            <button
              key={p.label}
              type="button"
              aria-pressed={active}
              onClick={() =>
                onChange(
                  active
                    ? { spatialResMin: null, spatialResMax: null }
                    : { spatialResMin: p.degrees, spatialResMax: p.degrees }
                )
              }
              className={cn(
                "inline-flex h-10 items-center rounded-full border px-3 text-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:h-8",
                active
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border text-muted-foreground hover:border-primary/50"
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
  | { kind: "facet"; key: CatalogueFacetKey; defaultOpen: boolean }
  | { kind: "temporal"; defaultOpen: boolean }
  | { kind: "resolution"; defaultOpen: boolean };

/** The order of the groups, top to bottom. */
const GROUPS: GroupSpec[] = [
  { kind: "facet", key: "type", defaultOpen: true },
  { kind: "facet", key: "category", defaultOpen: true },
  { kind: "facet", key: "output", defaultOpen: false },
  { kind: "facet", key: "forcing", defaultOpen: false },
  { kind: "temporal", defaultOpen: true },
  { kind: "resolution", defaultOpen: true },
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
    <aside aria-label="Filters" className="w-full lg:w-72 lg:shrink-0 xl:w-80">
      <div className="flex flex-col gap-4">
        <Card className="shrink-0 gap-0 rounded-xl border-0 py-0 shadow-sm">
          <div className="p-4">
            <label htmlFor="catalogue-search" className="mb-2 block text-sm font-semibold">
              Search
            </label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="catalogue-search"
                type="search"
                placeholder="Search the repository"
                value={filters.searchQuery}
                onChange={(e) => onChange({ searchQuery: e.target.value })}
                className="h-10 pl-9 lg:h-9"
              />
            </div>
          </div>
        </Card>

        <Button
          type="button"
          variant="outline"
          aria-expanded={panelOpen}
          aria-controls="catalogue-filters-panel"
          onClick={() => setPanelOpen((o) => !o)}
          className="h-10 w-full justify-between lg:hidden"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal aria-hidden="true" />
            Filters
            {activeCount > 0 && (
              <Badge className="bg-primary/10 text-primary">
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
            "gap-0 rounded-xl border-0 py-0 shadow-sm lg:flex",
            panelOpen ? "flex" : "hidden"
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2">
            <h2 className="text-base font-semibold text-foreground">Filters</h2>
            {anyActive && (
              <button
                type="button"
                onClick={onClearAll}
                className="inline-flex min-h-10 items-center rounded-md px-1 text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-8"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="px-4 py-2">
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
                  defaultOpen={group.defaultOpen}
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
