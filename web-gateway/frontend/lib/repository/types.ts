/**
 * The catalogue's dataset shape, built on the generated spec types
 * (`./generated.ts`, from `schemas/snapshot-spec/metadata/1.0.0.json` —
 * never hand-edit that file). See
 * `docs/reference/metadata-format.md#the-gateways-catalogue` for what every
 * field here is and, for the legacy fields this replaces, why each was
 * dropped or where it's derived from instead.
 */
import type { OpenGHMSnapshotMetadata } from "./generated";
import type { OpenGHMModelInputMetadata } from "./generated-model-input";

export type SortOption = "relevance" | "newest" | "title-az" | "title-za";

// ─── Dataset ──────────────────────────────────────────────────────────────────

/**
 * A snapshot as the API returns it: every spec field, unchanged, plus the
 * three values the backend computes and never stores — see
 * `app/models/repository.py`'s `DatasetResponse`.
 */
export interface Dataset extends OpenGHMSnapshotMetadata {
  spatialResolutionDegrees: number;
  licenseUrl: string;
  /** `runtime.generatedAt`, exposed at the top level too — the default sort key. */
  generatedAt: string;
}

// ─── Filter state ─────────────────────────────────────────────────────────────

export interface FilterState {
  searchQuery: string;
  temporalCoverageStart: number | null;
  temporalCoverageEnd: number | null;
  spatialResMin: number | null;
  spatialResMax: number | null;
  sortBy: SortOption;
  page: number;
}

// ─── API response ─────────────────────────────────────────────────────────────

export interface RepositoryListResponse {
  items: Dataset[];
  totalCount: number;
  totalPages: number;
  page: number;
}

// ─── Model input ───────────────────────────────────────────────────────────────

/**
 * A model input as the API returns it: every spec field, unchanged, plus
 * the one value the backend computes and never stores — see
 * `app/models/repository.py`'s `ModelInputResponse`. Sibling of `Dataset`
 * (ADR 0015, spec.md Decision 2) — both are published, immutable, citable
 * artifacts under the Data Repository.
 */
export interface ModelInput extends OpenGHMModelInputMetadata {
  licenseUrl: string;
}

export interface ModelInputFilterState {
  searchQuery: string;
  sortBy: SortOption;
  page: number;
}

export interface ModelInputListResponse {
  items: ModelInput[];
  totalCount: number;
  totalPages: number;
  page: number;
}
