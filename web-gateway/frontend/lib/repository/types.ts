export type DatasetType = "snapshot" | "raw_data";

export type SortOption = "relevance" | "newest" | "title-az" | "title-za";

export interface DatasetCreator {
  name: string;
  email?: string;
}

export interface RelatedLink {
  type?: string;
  roleName: string;
  url: string;
  doi?: string | null;
  description: string;
}

export interface SpatialCoverage {
  box: string;
  northlimit: number;
  southlimit: number;
  eastlimit: number;
  westlimit: number;
  units: string;
  projection: string;
  riverNetworkSource?: string | null;
  majorRivers?: string[] | null;
}

export interface AdminMetadata {
  generatedAt: string;
  lastUpdated: string;
  metadataStandard: string;
  metadataVersion: string;
  conformsTo: string[];
  applicationContext: string;
}

export interface VariableMeasured {
  name: string;
  unitText: string;
  standardName?: string;
}

// ─── Base (fields common to all dataset types) ───────────────────────────────

interface BaseDataset {
  id: string;
  slug?: string | null;
  datasetType: DatasetType;
  title: string;
  description: string;
  creators: DatasetCreator[];
  license: string;
  licenseUrl?: string;
  keywords: string[];
  tag: string;
  relatedLinks: RelatedLink[];
  yearPublished?: number | null;
  spatialResolution: string;
  spatialResolutionDegrees: number | null;
  spatialCoverage?: SpatialCoverage;
  temporalCoverage: string;
  temporalResolution: string | null;
  datasetVersion: string | null;
  format: string;
  fileSize: string;
  lastUpdated: string;
  adminMetadata?: AdminMetadata;
}

// ─── Snapshot (raw data + simulation parameters + outputs) ───────────────────

export interface SnapshotDataset extends BaseDataset {
  datasetType: "snapshot";
  softwareVersion: string;
  isBasedOn?: string;
  spinupPeriod?: string;
  processesOn?: string[];
  activeProcesses?: string[];
  variablesMeasured: VariableMeasured[];
  recommendedComputeSetting?: string[] | null;
}

// ─── Raw Data (data files only, no simulation metadata) ──────────────────────

export interface RawDataDataset extends BaseDataset {
  datasetType: "raw_data";
}

// ─── Discriminated union ──────────────────────────────────────────────────────

export type Dataset = SnapshotDataset | RawDataDataset;

// ─── Type guard helpers ───────────────────────────────────────────────────────

export function isSnapshot(d: Dataset): d is SnapshotDataset {
  return d.datasetType === "snapshot";
}

export function isRawData(d: Dataset): d is RawDataDataset {
  return d.datasetType === "raw_data";
}

// ─── Filter state ─────────────────────────────────────────────────────────────

export interface FilterState {
  searchQuery: string;
  datasetTypes: DatasetType[];
  variableTypes: string[];
  temporalCoverageStart: number | null;
  temporalCoverageEnd: number | null;
  spatialResMin: number | null;
  spatialResMax: number | null;
  temporalResolutions: string[];
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
