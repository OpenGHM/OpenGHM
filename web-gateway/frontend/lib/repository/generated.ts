/* GENERATED -- do not edit by hand. Run "just codegen" to regenerate.
 * Source: schemas/snapshot-spec/metadata/1.0.0.json */

/**
 * SLURM --time syntax, not an ISO 8601 duration: minutes, minutes:seconds, hours:minutes:seconds, days-hours[:minutes[:seconds]]. Hours are not capped at 24 (observed: 111:30:00).
 */
export type SlurmTime = string;
/**
 * Recorded when a past run's own record (SLURM accounting, logs) could not be recovered at rewrite time. Allowed only in runtime.execution's observation fields (cores, elapsedWalltime, startedAt, finishedAt, slurmJobId), never in cluster or anywhere else.
 */
export type Unknown = "unknown";

/**
 * metadata.json for one WBM snapshot. Fields are grouped by where their contents come from: about (a person, at publish), simulation (derived from the selected .init), uses (the publisher, at publish), runtime (the system). See docs/reference/metadata-format.md.
 */
export interface OpenGHMSnapshotMetadata {
  /**
   * This document's own schema version URL, e.g. https://schemas.openghm.org/snapshot-spec/metadata/1.0.0.json.
   */
  $schema: string;
  /**
   * Minted at publish, 256 random bits as lowercase hex. Not derived from the snapshot's content (ADR 0014). The S3 key under snapshots/.
   */
  id: string;
  /**
   * The human name at publish time. Not part of the S3 key; the catalog maps slug to id for browsing, and may remap it later without touching this file.
   */
  slug: string;
  about: OpenGHMCitationBlock;
  simulation: Simulation;
  uses: Uses;
  runtime: Runtime;
}
/**
 * The 'who published this, and how to cite it' block, shared by every OpenGHM artifact spec (snapshot, model input) rather than defined once per spec (ADR 0018). Field names are schema.org/Dataset property names on purpose, so a JSON-LD island can be generated for Google Dataset Search at render time (see metadata-format.md#notes) — that projection is generated, never stored.
 */
export interface OpenGHMCitationBlock {
  name: string;
  description: string;
  datePublished: string;
  /**
   * Open vocabulary, not an enum. A new value never needs a spec bump — see metadata-format.md#aboutcategory.
   */
  category: string;
  /**
   * @minItems 1
   */
  creator: [
    {
      name: string;
      email?: string;
      orcid?: string;
    },
    ...{
      name: string;
      email?: string;
      orcid?: string;
    }[]
  ];
  /**
   * A bare SPDX identifier, e.g. GPL-3.0-only. Not a URL.
   */
  license: string;
  /**
   * @minItems 1
   */
  keywords: [string, ...string[]];
  /**
   * The canonical gateway URL, built from the artifact's minted id — never from its slug, which can be renamed later (see metadata-format.md).
   */
  url: string;
  relatedLink?: {
    relation: string;
    roleName?: string;
    url: string;
    doi?: string | null;
    description?: string;
  }[];
}
export interface Simulation {
  /**
   * Path relative to wbm_init/, not a bare filename assumption — a snapshot can hold several .init files. Resolves to <snapshot>/wbm_init/<init>.
   */
  init: string;
  spatialCoverage: OpenGHMSpatialCoverage;
  resolution: {
    value: number;
    unit: "arc-minute" | "arc-second" | "degree";
  };
  temporalCoverage: {
    start: string;
    end: string;
  };
  /**
   * What the run is driven by: one entry per forcing time series the .init actually names — see metadata-format.md#forcing-roles. Variable length, not a fixed pair, but `role` is a closed vocabulary and a new role is an additive MINOR bump. `role` is unique within the array; JSON Schema cannot express that, so the generator and the validator enforce it.
   *
   * @minItems 1
   */
  inputVariables: [
    {
      role:
        | "precipitation"
        | "precipitationFraction"
        | "airTemperature"
        | "windU"
        | "windV"
        | "cloudFraction"
        | "humidity"
        | "albedo"
        | "leafAreaIndex";
      /**
       * The MT record driving this role, named by its own Code_Name field — read from inside the .init the run's MT_* key points at, not assumed from that file's basename. The two agree for the climate forcing used today (merra2_prectotcorr_d.init declares Code_Name merra2_prectotcorr_d) but not in general: several records in the staged ancillary data declare a Code_Name that differs from their filename (see model-input-spec's datasets[].code).
       */
      dataset: string;
      /**
       * The MT record's Name, e.g. 'MERRA2 Temperature at 2m, Daily'. Optional because it is copied out of a file that leaves the bundle under ADR 0015 — recording it here is what keeps this document readable without that file.
       */
      fullName?: string;
      /**
       * The MT record's Units — what WBM reads the series as, after Var_Scale and Var_Offset. NOT Orig_Units, which is the unit of the file on disk before scaling (e.g. K, not C; kg/(m^2 s), not mm/day). Optional for the same reason as fullName.
       */
      unit?: string;
    },
    ...{
      role:
        | "precipitation"
        | "precipitationFraction"
        | "airTemperature"
        | "windU"
        | "windV"
        | "cloudFraction"
        | "humidity"
        | "albedo"
        | "leafAreaIndex";
      /**
       * The MT record driving this role, named by its own Code_Name field — read from inside the .init the run's MT_* key points at, not assumed from that file's basename. The two agree for the climate forcing used today (merra2_prectotcorr_d.init declares Code_Name merra2_prectotcorr_d) but not in general: several records in the staged ancillary data declare a Code_Name that differs from their filename (see model-input-spec's datasets[].code).
       */
      dataset: string;
      /**
       * The MT record's Name, e.g. 'MERRA2 Temperature at 2m, Daily'. Optional because it is copied out of a file that leaves the bundle under ADR 0015 — recording it here is what keeps this document readable without that file.
       */
      fullName?: string;
      /**
       * The MT record's Units — what WBM reads the series as, after Var_Scale and Var_Offset. NOT Orig_Units, which is the unit of the file on disk before scaling (e.g. K, not C; kg/(m^2 s), not mm/day). Optional for the same reason as fullName.
       */
      unit?: string;
    }[]
  ];
  activeProcesses: string[];
  /**
   * What the run computes: one entry per name in the .init's Output_vars, resolved through the model's variable dictionary — see metadata-format.md.
   *
   * @minItems 1
   */
  outputVariables: [
    {
      name: string;
      /**
       * The dictionary's Full_name.
       */
      fullName: string;
      /**
       * The dictionary's Org_units[0] — the native unit, not an aggregated one.
       */
      unit: string;
    },
    ...{
      name: string;
      /**
       * The dictionary's Full_name.
       */
      fullName: string;
      /**
       * The dictionary's Org_units[0] — the native unit, not an aggregated one.
       */
      unit: string;
    }[]
  ];
  recommendedCompute: {
    cores: number;
    walltime: SlurmTime;
  };
}
/**
 * A bounding box in DCMI Box element names, shared by every OpenGHM artifact spec (ADR 0018) — see metadata-format.md#spatialcoverage for why. The DCMI `box`, `name`, `uplimit`, `downlimit` and `zunits` elements are deliberately absent: `box` restates the four limits, and the rest describe a vertical extent WBM does not model.
 */
export interface OpenGHMSpatialCoverage {
  northlimit: number;
  southlimit: number;
  eastlimit: number;
  westlimit: number;
  /**
   * The unit the four limits are expressed in. One value today, because WBM refuses to run a network that is not geographic — same reasoning as runtime.execution.cluster. A second unit is an additive MINOR bump.
   */
  units: "Decimal degrees";
  /**
   * The coordinate reference system of the grid this coverage describes. One value, because WBM dies on any other — see metadata-format.md#spatialcoverage. A source projection may be an EPSG code, a Proj4 string or WKT, so the generator recognises the CRS and emits this form, rather than transcribing the source's spelling. A second value is an additive MINOR bump, and would come with a native-CRS block rather than alone.
   */
  projection: "EPSG:4326";
}
export interface Uses {
  container: {
    image: string;
    version: string;
    digest: string;
    oras: string;
    https: string;
  };
  modelInput: {
    /**
     * Minted at publish, same rule as the snapshot id (ADR 0014). Two snapshots built from the same input data share this value.
     */
    id: string;
  };
}
export interface Runtime {
  generatedAt: string;
  execution: {
    /**
     * Every compute-node fact in this project assumes one cluster today. A second cluster is an additive MINOR bump.
     */
    cluster: "anvil";
    cores: number | Unknown;
    elapsedWalltime: SlurmTime | Unknown;
    startedAt: string | Unknown;
    finishedAt: string | Unknown;
    slurmJobId: string | Unknown;
  };
}
