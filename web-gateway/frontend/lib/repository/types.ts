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

/**
 * The catalogue route's sorts: the single-kind routes' four, and earliest
 * temporal coverage start first. `/datasets` and `/model-inputs` do not take
 * the last, so it is not in `SortOption`.
 */
export type CatalogueSortOption = SortOption | "coverage-start";

/** How the catalogue lays its cards out. A view of the same results, so it is not sent to the backend. */
export type CatalogueView = "list" | "grid";

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
  /** Where a simulation of this snapshot may start, read from its init by the single
   *  snapshot route only (`DatasetDetailResponse`): `year` January 1, `month`
   *  the first of a month, `none` no rule, `null` the init could not be read.
   *  Absent on a list row. */
  runStartAlignment?: "year" | "month" | "none" | null;
  /** The year the init's multi-year aggregation starts in, which a simulation must
   *  reach (`lib/jobs/aggregation-window.ts`); `null` when the init sets none
   *  or could not be read. Absent on a list row. */
  aggregationStartYear?: number | null;
  /** What the snapshot's own init does after the simulation, read from it by the
   *  single snapshot route only: `none` the init has no post-processing settings,
   *  `standard` daily, monthly and yearly output, `climatology` that and
   *  the climatologies; `null` the init could not be read. Absent on a list row. */
  postProcessing?: "none" | "standard" | "climatology" | null;
  /** Whether a draft may ask for climatology: the init has a post-processing run
   *  to turn on and the snapshot has a measured `postProcessingWalltime` to size
   *  the walltime by. Single snapshot route only; absent counts as false. */
  climatologyAvailable?: boolean;
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

// ─── Catalogue (snapshots and model inputs in one list) ─────────────────────

/** What a catalogue row is: a snapshot or a model input. */
export type CatalogueKind = "snapshot" | "model-input";

/**
 * One row of `GET /repository/catalogue`: the same JSON the single-kind
 * routes return, plus `kind` so the list can tell them apart.
 */
export type CatalogueItem =
  | (Dataset & { kind: "snapshot" })
  | (ModelInput & { kind: "model-input" });

/** One checkbox in a facet group. `count` ignores that group's own selection. */
export interface CatalogueFacetOption {
  value: string;
  label: string;
  count: number;
}

/** The facet keys that are repeatable query parameters with option lists. */
export type CatalogueFacetKey =
  | "type"
  | "tag"
  | "keyword"
  | "creator"
  | "license"
  | "output"
  | "forcing"
  | "process"
  | "wbm";

export interface CatalogueFacets extends Record<CatalogueFacetKey, CatalogueFacetOption[]> {
  /** The earliest and latest year any item covers, or `null` when none has a period. */
  yearBounds: { min: number; max: number } | null;
}

export interface CatalogueResponse {
  items: CatalogueItem[];
  totalCount: number;
  totalPages: number;
  page: number;
  facets: CatalogueFacets;
}

/**
 * Who may find an artifact in the catalogue: the envelope's `visibility`.
 * Separate from freezing, which every published artifact is.
 */
export type Visibility = "public" | "private";

/**
 * A catalogue item the signed-in user owns: the item plus the envelope's
 * `visibility` and `registeredAt` (an ISO timestamp, when this gateway learned
 * of the artifact). Spread over the union, so each kind keeps its own shape.
 */
export type MineItem = CatalogueItem & { visibility: Visibility; registeredAt: string };

/** `GET /repository/mine`: what the signed-in user published, newest registration first. No paging, no facets. */
export interface MineResponse {
  items: MineItem[];
}

/**
 * The catalogue's filters. Each facet key holds the selected option `value`s
 * and is also the query-parameter name (repeated, one per value): within one
 * facet the values are OR, across facets AND.
 */
export interface CatalogueFilterState extends Record<CatalogueFacetKey, string[]> {
  searchQuery: string;
  yearStart: number | null;
  yearEnd: number | null;
  /** Degrees. */
  spatialResMin: number | null;
  spatialResMax: number | null;
  /**
   * A bounding box in decimal degrees (EPSG:4326): the filter matches an item
   * whose spatial coverage overlaps it. All four are set or none is; `west`
   * above `east` crosses the antimeridian.
   */
  boxNorth: number | null;
  boxSouth: number | null;
  boxEast: number | null;
  boxWest: number | null;
  sortBy: CatalogueSortOption;
  /** Kept in the URL as `view=grid`; `list` is the default and is omitted. */
  view: CatalogueView;
  page: number;
}

// ─── Download links ───────────────────────────────────────────────────────────

/**
 * `GET /repository/datasets/{id}/links` — plain public HTTPS strings the
 * backend builds from `S3_PUBLIC_BASE_URL` and the bucket (no S3 call); see
 * `app/models/repository.py`'s `SnapshotLinks`. Hand-written: not part of
 * the snapshot spec.
 */
export interface SnapshotLinks {
  id: string;
  /** `snapshots/<id>/` — the whole tree, many files. */
  treeUrl: string;
  metadataUrl: string;
  sha256sumsUrl: string;
  /** `openghm snapshot fetch <id>` */
  fetchCommand: string;
  /** `uses.container.https` */
  containerUrl: string;
  modelInputId: string;
  modelInputTreeUrl: string;
}

/** `GET /repository/model-inputs/{id}/links` — `ModelInputLinks` in the backend. */
export interface ModelInputLinks {
  id: string;
  treeUrl: string;
  metadataUrl: string;
  sha256sumsUrl: string;
}

// ─── Browsing a published tree ────────────────────────────────────────────────

/** Which published tree a listing or a preview reads: `snapshots/<id>/` or `model-inputs/<id>/`. */
export type TreeKind = "snapshot" | "model_input";

export interface TreeFolder {
  name: string;
  /** Relative to the tree's root, ending with `/`. */
  path: string;
}

export interface TreeFile {
  name: string;
  /** Relative to the tree's root. */
  path: string;
  size: number;
  lastModified: string;
  /** The object's public HTTPS URL; the browser follows it directly. */
  url: string;
  /** False for a known binary extension: the backend does not read it for a preview. */
  previewable: boolean;
}

/**
 * `GET /repository/{datasets|model-inputs}/{id}/files` — one folder, one S3
 * page of it (`TreeListing` in the backend's `app/models/repository.py`).
 * Hand-written: not part of the snapshot spec.
 */
export interface TreeListing {
  id: string;
  path: string;
  folders: TreeFolder[];
  files: TreeFile[];
  /** The token for the folder's next page; null on the last. */
  nextCursor: string | null;
}

/** `GET .../files/preview` — a file's first bytes (`TreePreview` in the backend). */
export interface TreePreview {
  path: string;
  /** The object's whole size, not the preview's. */
  size: number;
  kind: "text" | "binary";
  text: string | null;
  truncated: boolean;
}

/**
 * Why a listing or a preview did not come: the backend's `detail.code`, or
 * `not_found` for an id the catalogue does not hold (a plain 404).
 */
export type TreeErrorCode =
  | "invalid_path"
  | "path_not_found"
  | "listing_unavailable"
  | "preview_unavailable"
  | "not_found";

/** A server action's answer: the data, or the code the UI shows a state for. */
export type TreeResult<T> = { ok: true; data: T } | { ok: false; code: TreeErrorCode };
