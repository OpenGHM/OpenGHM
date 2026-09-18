/**
 * Static fallback constants used by the sidebar for initial filter state.
 * These will eventually be replaced by a /api/v1/repository/facets endpoint
 * that returns live aggregates from the backend.
 */

// Common spatial resolution presets (label → degrees)
export const SPATIAL_RES_PRESETS = [
  { label: "30 arc-sec", degrees: 30 / 3600 },
  { label: "5 arc-min", degrees: 5 / 60 },
  { label: "15 arc-min", degrees: 15 / 60 },
  { label: "0.25°", degrees: 0.25 },
  { label: "0.5°", degrees: 0.5 },
  { label: "1°", degrees: 1.0 },
];

// Temporal bounds for the year-range filter
export const TEMPORAL_RANGE_BOUNDS = {
  min: 1940,
  max: new Date().getFullYear(),
};

export const ITEMS_PER_PAGE = 5;
