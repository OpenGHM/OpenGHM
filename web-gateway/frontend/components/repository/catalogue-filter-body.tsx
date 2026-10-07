"use client";

import {
  facetGroupOptions,
  groupActiveCount,
  type CatalogueFilterGroup,
} from "@/lib/repository/catalogue";
import { TEMPORAL_RANGE_BOUNDS } from "@/lib/repository/data";
import type { CatalogueFacets, CatalogueFilterState } from "@/lib/repository/types";
import {
  COLLAPSED_OPTION_COUNT,
  FacetCheckboxList,
  RegionFilter,
  ResolutionFilter,
  YearRangeFilter,
} from "./catalogue-filter-controls";
import { FilterGroup } from "./filter-group";

/**
 * The body of one group of `CATALOGUE_FILTER_GROUPS`: the control that group
 * filters with, wired to the filter state. The Data Repository's sidebar, the
 * Start screen's snapshot picker's compact panel and its "More filters" dialog
 * all render their groups through it, each in its own frame and with its own
 * heading; which groups there are, and which control each has, is decided once,
 * in the definition.
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
    case "region":
      return (
        <RegionFilter
          north={filters.boxNorth}
          south={filters.boxSouth}
          east={filters.boxEast}
          west={filters.boxWest}
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

/**
 * One group as the sidebar and the picker's "More filters" dialog frame it: a
 * collapsible `FilterGroup` (open as the definition says, and open whenever it
 * holds a selection) around the group's body.
 */
export function CatalogueFilterSection({
  group,
  filters,
  facets,
  onChange,
}: {
  group: CatalogueFilterGroup;
  filters: CatalogueFilterState;
  facets: CatalogueFacets;
  onChange: (updates: Partial<CatalogueFilterState>) => void;
}) {
  const defaultOpen =
    group.defaultOpen === "when-short"
      ? group.kind === "facet" &&
        facetGroupOptions(group.key, facets).length <= (group.shortAtMost ?? COLLAPSED_OPTION_COUNT)
      : group.defaultOpen;
  return (
    <FilterGroup
      title={group.title}
      defaultOpen={defaultOpen}
      activeCount={groupActiveCount(group, filters)}
    >
      <CatalogueFilterBody group={group} filters={filters} facets={facets} onChange={onChange} />
    </FilterGroup>
  );
}
