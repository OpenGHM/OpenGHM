"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { FilterGroup } from "./filter-group";
import { DatasetType, FilterState } from "@/lib/repository/types";
import {
  ALL_VARIABLE_TYPES,
  SPATIAL_RES_PRESETS,
  TEMPORAL_RANGE_BOUNDS,
} from "@/lib/repository/data";
import { Search, FilterX } from "lucide-react";

type SpatialUnit = "deg" | "arcmin" | "arcsec";

const UNIT_OPTIONS: { value: SpatialUnit; label: string; symbol: string; multiplier: number }[] = [
  { value: "deg",    label: "Degrees",     symbol: "°",  multiplier: 1    },
  { value: "arcmin", label: "Arc-minutes", symbol: "′",  multiplier: 60   },
  { value: "arcsec", label: "Arc-seconds", symbol: "″",  multiplier: 3600 },
];

const DATASET_TYPE_OPTIONS: { value: DatasetType; label: string; description: string }[] = [
  { value: "snapshot", label: "Model Snapshot", description: "Simulation outputs with full provenance" },
  { value: "raw_data", label: "Model Inputs",   description: "Forcing data files used as model inputs" },
];

// ─── Reusable checkbox-with-All helper ───────────────────────────────────────

function CheckboxItem({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 size-3.5 rounded border-border accent-primary"
      />
      <span>
        <span className="font-medium">{label}</span>
        {description && (
          <span className="block text-xs text-muted-foreground">{description}</span>
        )}
      </span>
    </label>
  );
}

function CheckboxFilterWithAll<T extends string>({
  options,
  selected,
  onChange,
}: {
  options: { value: T; label: string; description?: string }[];
  selected: T[];
  onChange: (next: T[]) => void;
}) {
  const allChecked = selected.length === 0;

  const toggle = (value: T) => {
    const next = selected.includes(value)
      ? selected.filter((v) => v !== value)
      : [...selected, value];
    onChange(next);
  };

  return (
    <>
      <CheckboxItem
        checked={allChecked}
        onChange={() => onChange([])}
        label="All"
      />
      {options.map((o) => (
        <CheckboxItem
          key={o.value}
          checked={selected.includes(o.value)}
          onChange={() => toggle(o.value)}
          label={o.label}
          description={o.description}
        />
      ))}
    </>
  );
}

// ─── Main sidebar ─────────────────────────────────────────────────────────────

export function RepositorySidebar({
  filters,
  onFiltersChange,
  onClearAll,
}: {
  filters: FilterState;
  onFiltersChange: (updates: Partial<FilterState>) => void;
  onClearAll: () => void;
}) {
  const [spatialUnit, setSpatialUnit] = useState<SpatialUnit>("deg");

  // ── Temporal Coverage ──
  const temporalAllChecked =
    filters.temporalCoverageStart == null && filters.temporalCoverageEnd == null;

  const handleTemporalAllToggle = () => {
    if (temporalAllChecked) {
      // Uncheck All → activate filter with default bounds
      onFiltersChange({
        temporalCoverageStart: TEMPORAL_RANGE_BOUNDS.min,
        temporalCoverageEnd: TEMPORAL_RANGE_BOUNDS.max,
      });
    } else {
      // Check All → clear filter
      onFiltersChange({ temporalCoverageStart: null, temporalCoverageEnd: null });
    }
  };

  // ── Spatial Resolution ──
  const spatialAllChecked =
    filters.spatialResMin == null && filters.spatialResMax == null;

  const handleSpatialAllToggle = () => {
    if (!spatialAllChecked) {
      onFiltersChange({ spatialResMin: null, spatialResMax: null });
    }
  };

  // ── hasActiveFilters (drives "Clear All Filters" button) ──
  const hasActiveFilters =
    !!filters.searchQuery ||
    filters.datasetTypes.length > 0 ||
    filters.variableTypes.length > 0 ||
    filters.temporalResolutions.length > 0 ||
    filters.spatialResMin !== null ||
    filters.spatialResMax !== null ||
    filters.temporalCoverageStart !== null ||
    filters.temporalCoverageEnd !== null;

  return (
    <aside className="w-80 shrink-0">
      <div className="sticky top-24 space-y-4 rounded-xl border border-border bg-card p-5">

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search datasets..."
            value={filters.searchQuery}
            onChange={(e) => onFiltersChange({ searchQuery: e.target.value })}
            className="pl-9"
          />
        </div>

        {/* Dataset Type */}
        <FilterGroup title="Dataset Type">
          <CheckboxFilterWithAll
            options={DATASET_TYPE_OPTIONS}
            selected={filters.datasetTypes}
            onChange={(next) => onFiltersChange({ datasetTypes: next })}
          />
        </FilterGroup>

        {/* Variable Type */}
        <FilterGroup title="Variable Type">
          <CheckboxFilterWithAll
            options={ALL_VARIABLE_TYPES.map((v) => ({ value: v, label: v }))}
            selected={filters.variableTypes}
            onChange={(next) => onFiltersChange({ variableTypes: next })}
          />
        </FilterGroup>

        {/* Temporal Coverage */}
        <FilterGroup title="Temporal Coverage">
          <div className="space-y-3">
            <CheckboxItem
              checked={temporalAllChecked}
              onChange={handleTemporalAllToggle}
              label="All"
            />
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="w-10 text-xs text-muted-foreground">From</label>
                <input
                  type="number"
                  min={TEMPORAL_RANGE_BOUNDS.min}
                  max={filters.temporalCoverageEnd ?? TEMPORAL_RANGE_BOUNDS.max}
                  value={filters.temporalCoverageStart ?? TEMPORAL_RANGE_BOUNDS.min}
                  disabled={temporalAllChecked}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || TEMPORAL_RANGE_BOUNDS.min;
                    onFiltersChange({
                      temporalCoverageStart: val,
                      temporalCoverageEnd: filters.temporalCoverageEnd ?? TEMPORAL_RANGE_BOUNDS.max,
                    });
                  }}
                  className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-40"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="w-10 text-xs text-muted-foreground">To</label>
                <input
                  type="number"
                  min={filters.temporalCoverageStart ?? TEMPORAL_RANGE_BOUNDS.min}
                  max={TEMPORAL_RANGE_BOUNDS.max}
                  value={filters.temporalCoverageEnd ?? TEMPORAL_RANGE_BOUNDS.max}
                  disabled={temporalAllChecked}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || TEMPORAL_RANGE_BOUNDS.max;
                    onFiltersChange({
                      temporalCoverageStart: filters.temporalCoverageStart ?? TEMPORAL_RANGE_BOUNDS.min,
                      temporalCoverageEnd: val,
                    });
                  }}
                  className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-40"
                />
              </div>
            </div>
          </div>
        </FilterGroup>

        {/* Spatial Resolution */}
        <FilterGroup title="Spatial Resolution">
          {(() => {
            const SLIDER_MIN = 0;
            const SLIDER_MAX = 2;
            const SLIDER_STEP = 0.001;
            const lo = filters.spatialResMin ?? SLIDER_MIN;
            const hi = filters.spatialResMax ?? SLIDER_MAX;
            const unit = UNIT_OPTIONS.find((u) => u.value === spatialUnit)!;

            const fmt = (v: number) => {
              const converted = v * unit.multiplier;
              if (unit.value === "deg")    return `${converted.toFixed(converted < 0.1 ? 4 : 2)}${unit.symbol}`;
              if (unit.value === "arcmin") return `${converted.toFixed(1)}${unit.symbol}`;
              return `${Math.round(converted)}${unit.symbol}`;
            };

            return (
              <div className="space-y-3">
                <CheckboxItem
                  checked={spatialAllChecked}
                  onChange={handleSpatialAllToggle}
                  label="All"
                />
                {/* Unit selector */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Unit:</span>
                  <div className="flex gap-1">
                    {UNIT_OPTIONS.map((u) => (
                      <button
                        key={u.value}
                        type="button"
                        onClick={() => setSpatialUnit(u.value)}
                        title={u.label}
                        className={`rounded px-2 py-0.5 text-xs transition-colors ${
                          spatialUnit === u.value
                            ? "bg-primary text-primary-foreground font-medium"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {u.symbol}
                      </button>
                    ))}
                  </div>
                </div>

                <Slider
                  min={SLIDER_MIN}
                  max={SLIDER_MAX}
                  step={SLIDER_STEP}
                  value={[lo, hi]}
                  onValueChange={([newLo, newHi]) => {
                    const atMin = newLo <= SLIDER_MIN;
                    const atMax = newHi >= SLIDER_MAX;
                    onFiltersChange({
                      spatialResMin: atMin && atMax ? null : newLo,
                      spatialResMax: atMin && atMax ? null : newHi,
                    });
                  }}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{spatialAllChecked ? "finest" : fmt(lo)}</span>
                  <span className="text-[10px] text-muted-foreground/50">Fine ← → Coarse</span>
                  <span>{spatialAllChecked ? "coarsest" : fmt(hi)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {SPATIAL_RES_PRESETS.map((p) => {
                    const isPreset =
                      filters.spatialResMin === p.degrees &&
                      filters.spatialResMax === p.degrees;
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() =>
                          onFiltersChange(
                            isPreset
                              ? { spatialResMin: null, spatialResMax: null }
                              : { spatialResMin: p.degrees, spatialResMax: p.degrees }
                          )
                        }
                        className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                          isPreset
                            ? "border-primary bg-primary/10 font-medium text-primary"
                            : "border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </FilterGroup>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearAll}
            className="w-full text-muted-foreground"
          >
            <FilterX className="size-4" />
            Clear All Filters
          </Button>
        )}
      </div>
    </aside>
  );
}
