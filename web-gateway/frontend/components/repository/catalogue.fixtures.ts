/**
 * Typed fixtures for the catalogue's tests. Only tests import this file; a
 * real page never does.
 */
import { EMPTY_CATALOGUE_FILTERS } from "@/lib/repository/catalogue";
import { fakeDataset } from "@/lib/workspace/fixtures";
import type {
  CatalogueFacets,
  CatalogueFilterState,
  CatalogueItem,
  CatalogueResponse,
  ModelInput,
} from "@/lib/repository/types";

const CONUS = {
  northlimit: 49,
  southlimit: 24,
  eastlimit: -66,
  westlimit: -125,
  units: "Decimal degrees",
  projection: "EPSG:4326",
} as const;

const WORLD = {
  northlimit: 90,
  southlimit: -90,
  eastlimit: 180,
  westlimit: -180,
  units: "Decimal degrees",
  projection: "EPSG:4326",
} as const;

export function snapshotItem(overrides: Partial<CatalogueItem & { kind: "snapshot" }> = {}) {
  const base = fakeDataset({
    id: "snap-1",
    about: {
      name: "Global Storage Run",
      description: "Monthly storage terms from a global water balance run.",
      datePublished: "2026-03-14T10:00:00Z",
      category: "hydrology",
      creator: [{ name: "Ada Hydro" }, { name: "Bo Flow" }],
      license: "GPL-3.0-only",
      keywords: ["storage"],
      url: "https://openghm.org/repository/snap-1",
    },
    simulation: {
      init: "wbm.init",
      spatialCoverage: WORLD,
      resolution: { value: 5, unit: "arc-minute" },
      temporalCoverage: { start: "2000-01-01", end: "2009-12-31" },
      inputVariables: [{ role: "precipitation", dataset: "gpcc" }],
      activeProcesses: ["irrigation"],
      outputVariables: [
        { name: "discharge", fullName: "Discharge", unit: "m3/s" },
        { name: "runoff", fullName: "Runoff", unit: "mm" },
        { name: "soilMoisture", fullName: "Soil moisture", unit: "mm" },
        { name: "evapotranspiration", fullName: "Evapotranspiration", unit: "mm" },
        { name: "groundwater", fullName: "Groundwater", unit: "mm" },
      ],
      recommendedCompute: { cores: 16, walltime: "15:00" },
    },
    uses: {
      container: { image: "wbm", version: "1.0.0", digest: "sha256:abc", oras: "", https: "" },
      modelInput: { id: "mi-1" },
    },
  });
  return { ...base, kind: "snapshot" as const, ...overrides };
}

export function modelInputItem(overrides: Partial<ModelInput> = {}): CatalogueItem {
  const base: ModelInput = {
    $schema: "https://schemas.openghm.org/model-input-spec/metadata/1.0.0.json",
    id: "mi-1",
    slug: "ancillary-data",
    about: {
      name: "Ancillary Data v1",
      description: "Network, soils and land cover for the water balance model.",
      datePublished: "2025-11-02T08:00:00Z",
      category: "ancillary",
      creator: [{ name: "Cy Soil" }],
      license: "CC-BY-4.0",
      keywords: ["network", "soils", "land cover", "elevation", "lakes"],
      url: "https://openghm.org/repository/model-inputs/mi-1",
    },
    coverage: { spatialCoverage: CONUS },
    networks: [
      { file: "a.nc", resolution: { value: 5, unit: "arc-minute" } },
      { file: "b.nc", resolution: { value: 5, unit: "arc-minute" } },
      { file: "c.nc", resolution: { value: 30, unit: "arc-second" } },
    ],
    datasets: [
      { code: "soil", init: "soil.init" },
      { code: "lcover", init: "lc.init" },
      { code: "dem", init: "dem.init" },
    ],
    licenseUrl: "https://spdx.org/licenses/CC-BY-4.0.html",
    ...overrides,
  };
  return { ...base, kind: "model-input" };
}

export function filters(overrides: Partial<CatalogueFilterState> = {}): CatalogueFilterState {
  return { ...EMPTY_CATALOGUE_FILTERS, ...overrides };
}

const opt = (value: string, label: string, count: number) => ({ value, label, count });

export const FACETS: CatalogueFacets = {
  type: [opt("snapshot", "Model Snapshot", 2), opt("model-input", "Model Input", 1)],
  category: [opt("hydrology", "hydrology", 2), opt("ancillary", "ancillary", 1)],
  output: [
    opt("discharge", "Discharge", 9),
    opt("runoff", "Runoff", 8),
    opt("soilMoisture", "Soil moisture", 7),
    opt("evapotranspiration", "Evapotranspiration", 6),
    opt("groundwater", "Groundwater", 5),
    opt("snowPack", "Snow pack", 4),
    opt("irrigation", "Irrigation", 3),
    opt("lakeStorage", "Lake storage", 2),
  ],
  forcing: [opt("precipitation", "precipitation", 3), opt("windU", "windU", 2)],
  wbm: [opt("1.0.0", "1.0.0", 2)],
  process: [],
  creator: [opt("Ada Hydro", "Ada Hydro", 2)],
  license: [opt("GPL-3.0-only", "GPL-3.0-only", 2), opt("CC-BY-4.0", "CC-BY-4.0", 1)],
  yearBounds: { min: 1990, max: 2020 },
};

export function response(
  items: CatalogueItem[],
  overrides: Partial<CatalogueResponse> = {}
): CatalogueResponse {
  return {
    items,
    totalCount: items.length,
    totalPages: 1,
    page: 1,
    facets: FACETS,
    ...overrides,
  };
}
