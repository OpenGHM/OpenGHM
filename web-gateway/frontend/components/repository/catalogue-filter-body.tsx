"use client";

import { facetGroupOptions, type CatalogueFilterGroup } from "@/lib/repository/catalogue";
import { TEMPORAL_RANGE_BOUNDS } from "@/lib/repository/data";
import type { CatalogueFacets, CatalogueFilterState } from "@/lib/repository/types";
import { FacetCheckboxList, ResolutionFilter, YearRangeFilter } from "./catalogue-filter-controls";

/**
 * The body of one group of `CATALOGUE_FILTER_GROUPS`: the control that group
 * filters with, wired to the filter state. The Data Repository's sidebar and the
 * Start screen's snapshot picker both render their groups through it, each in
 * its own frame and with its own heading; which groups there are, and which
 * control each has, is decided once, in the definition.
 */
export function CatalogueFilterBody({
  group,
  filters,
  facets,
  onChange,
}: {
  group: CatalogueFilterGroup;
  filters: CatalogueFilterState;
  /** The facet counts of the last answer that came. */
  facets: CatalogueFacets;
  onChange: (updates: Partial<CatalogueFilterState>) => void;
}) {
  switch (group.kind) {
    case "temporal":
      return (
        <YearRangeFilter
          bounds={facets.yearBounds ?? TEMPORAL_RANGE_BOUNDS}
          start={filters.yearStart}
          end={filters.yearEnd}
          onChange={onChange}
        />
      );
    case "resolution":
      return (
        <ResolutionFilter
          min={filters.spatialResMin}
          max={filters.spatialResMax}
          onChange={onChange}
        />
      );
    case "facet":
      return (
        <FacetCheckboxList
          facetKey={group.key}
          options={facetGroupOptions(group.key, facets)}
          selected={filters[group.key]}
          onChange={(next) => onChange({ [group.key]: next })}
        />
      );
  }
}
