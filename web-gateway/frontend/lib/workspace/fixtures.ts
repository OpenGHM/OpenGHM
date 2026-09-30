/**
 * Fake data for the simulation lifecycle UI.
 *
 * Everything a real run would produce is invented here: SLURM ids, timings,
 * stdout/stderr, output files, progress. None of it is fetched, because none
 * of it exists — nothing runs real WBM ([open item 9]), nothing writes output
 * to S3 (Next 8), and no route returns a result listing.
 *
 * What is *not* invented is shape. Simulations are `Job`, logs are
 * `JobLogsResponse`, and any snapshot or model-input metadata comes from the
 * generated spec types. A field name that does not exist in the spec does not
 * exist here either: the point of building this UI ahead of the plumbing is
 * that the plumbing can be built to fit it, which only works if the shapes are
 * already right.
 *
 * Delete this module when the routes behind it are real. Anything importing it
 * is, by definition, not yet connected.
 */
import type { Job, JobLogsResponse, JobStatus } from "@/lib/jobs/types";
import type { Dataset } from "@/lib/repository/types";

/** A file a finished run would have written. No route returns these yet. */
export interface FakeOutputFile {
  /** Path relative to the run's output root, e.g. `wbm_output/discharge_2001.nc`. */
  path: string;
  sizeBytes: number;
  /** What a download link would point at once job output reaches S3 (Next 8). */
  href: string | null;
}

/** Coarse progress for a running simulation. SLURM reports no percentage; this
 *  is derived from elapsed-vs-requested walltime, which is the honest proxy. */
export interface FakeProgress {
  elapsed: string;
  requested: string;
  /** 0–1, elapsed/requested, clamped. Not a measure of work done. */
  fraction: number;
  /** The step a WBM run is in, as its stdout would report it. */
  stage: string;
}

const HOUR = 3_600_000;

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

/** The parameters every fixture starts from — a plausible one-year global run. */
const BASE_PARAMETERS: Job["parameters"] = {
  temporal_range_start: "2001-01-01",
  temporal_range_end: "2001-12-31",
  spatial_domain: null,
  variables: ["discharge", "runoff", "streamAge"],
  custom_params: null,
};

const BASE_SLURM: Job["slurm_config"] = {
  cores: 16,
  walltime: "00:15:00",
};

/**
 * A simulation in a given state, with the fields that state would actually
 * have — a queued run has no `started_at`, a failed one has a `status_reason`,
 * and only a finished one has an `output_s3_key`.
 */
export function fakeSimulation(status: JobStatus, overrides: Partial<Job> = {}): Job {
  const submitted = status === "DRAFT" ? null : iso(3 * HOUR);
  const started =
    status === "DRAFT" || status === "PENDING" || status === "SUBMITTED"
      ? null
      : iso(2 * HOUR);
  const completed =
    status === "COMPLETED" || status === "FAILED" || status === "CANCELLED"
      ? iso(HOUR)
      : null;

  return {
    id: `fake-${status.toLowerCase()}`,
    sim_id: status === "DRAFT" ? "" : `sim-20260921-${status.slice(0, 4).toLowerCase()}`,
    user_id: "mock-user-001",
    dataset_id: "fc66a2cdeee9d456f83bc0b0a6f00cd447b0194c124a3bb4008a02990779ec89",
    dataset_title: "WBM v2.0.0 simulation as tutorial: [Global] [2001]",
    slug: null,
    about: null,
    model_input_id: null,
    effective_model_input_id: null,
    effective_model_input_state: "inherited",
    slurm_job_id: status === "DRAFT" ? null : "12345680",
    slurm_job_name: status === "DRAFT" ? "" : "wbm-sim",
    status,
    status_reason:
      status === "FAILED"
        ? "wbm.pl exited 1 — see stderr"
        : status === "CANCELLED"
          ? "Cancelled by the user"
          : null,
    parameters: BASE_PARAMETERS,
    slurm_config: BASE_SLURM,
    created_at: iso(4 * HOUR),
    submitted_at: submitted,
    started_at: started,
    completed_at: completed,
    updated_at: completed ?? started ?? submitted ?? iso(4 * HOUR),
    output_s3_key: status === "COMPLETED" ? "outputs/sim-20260921-comp/" : null,
    toolkit: null,
    work_dir: null,
    remote_job_dir: null,
    last_submit_error: null,
    ...overrides,
  };
}

/** stdout as a WBM run under SLURM would leave it. */
export function fakeLogs(status: JobStatus, jobId: string): JobLogsResponse {
  if (status === "FAILED") {
    return {
      job_id: jobId,
      stdout: [
        "Loading network: hyd_5m_global.asc",
        "Spinup 1/1: 2000-01-01 .. 2000-12-31",
        "Run: 2001-01-01 .. 2001-12-31",
        "  2001-01 .. done",
        "  2001-02 .. done",
        "  2001-03 ..",
      ].join("\n"),
      stderr: [
        "Use of uninitialized value in numeric lt (<) at /wbm/model/wbm.pl line 2841.",
        "ERROR: cannot open data_init/climate/merra2_prectotcorr_d.init: No such file or directory",
        "  at /wbm/model/RIMS.pm line 1184.",
        "wbm.pl exited with status 1",
      ].join("\n"),
      truncated: false,
    };
  }
  if (status === "COMPLETED") {
    return {
      job_id: jobId,
      stdout: [
        "Loading network: hyd_5m_global.asc",
        "Spinup 1/1: 2000-01-01 .. 2000-12-31",
        "Run: 2001-01-01 .. 2001-12-31",
        ...Array.from({ length: 12 }, (_, i) =>
          `  2001-${String(i + 1).padStart(2, "0")} .. done`),
        "Writing wbm_output/ (3 variables, monthly + yearly aggregates)",
        "Elapsed: 12:47",
      ].join("\n"),
      stderr: "",
      truncated: false,
    };
  }
  if (status === "RUNNING" || status === "COMPLETING") {
    return {
      job_id: jobId,
      stdout: [
        "Loading network: hyd_5m_global.asc",
        "Spinup 1/1: 2000-01-01 .. 2000-12-31",
        "Run: 2001-01-01 .. 2001-12-31",
        "  2001-01 .. done",
        "  2001-02 .. done",
        "  2001-03 .. done",
        "  2001-04 ..",
      ].join("\n"),
      stderr: "",
      truncated: true,
    };
  }
  return { job_id: jobId, stdout: "", stderr: "", truncated: false };
}

/** What a finished run would have written. Nothing serves these files. */
export function fakeOutputFiles(): FakeOutputFile[] {
  return [
    { path: "wbm_output/discharge_2001_monthly.nc", sizeBytes: 184_320_000, href: null },
    { path: "wbm_output/runoff_2001_monthly.nc", sizeBytes: 176_128_000, href: null },
    { path: "wbm_output/streamAge_2001_monthly.nc", sizeBytes: 168_960_000, href: null },
    { path: "wbm_output/discharge_2001_yearly.nc", sizeBytes: 15_360_000, href: null },
    { path: "slurm-12345680.out", sizeBytes: 4_096, href: null },
  ];
}

export function fakeProgress(): FakeProgress {
  return { elapsed: "4:18", requested: "15:00", fraction: 4.3 / 15, stage: "Run: 2001-04" };
}

/**
 * A `Dataset` (published snapshot) for component tests — e.g.
 * `dataset-table.test.tsx`, `repository-results.test.tsx`. This is the one
 * place fake data lives in this frontend (spec.md, `2026-09-23-pick-a-snapshot`),
 * so a test fixture belongs here too rather than as a second hand-built
 * literal that drifts from the spec the next time `just codegen` runs.
 * Every field is real spec shape (`OpenGHMSnapshotMetadata` via `Dataset`),
 * not invented — same rule as the rest of this module.
 */
export function fakeDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    $schema: "https://schemas.openghm.org/snapshot-spec/metadata/1.0.0.json",
    id: "fake-dataset-id",
    slug: "fake-dataset",
    about: {
      name: "Fake Snapshot",
      description: "A snapshot used only in tests.",
      datePublished: "2026-01-01T00:00:00Z",
      category: "hydrology",
      creator: [{ name: "Test Author" }],
      license: "GPL-3.0-only",
      keywords: ["test"],
      url: "https://openghm.org/repository/fake-dataset-id",
    },
    simulation: {
      init: "test.init",
      spatialCoverage: {
        northlimit: 10,
        southlimit: -10,
        eastlimit: 10,
        westlimit: -10,
        units: "Decimal degrees",
        projection: "EPSG:4326",
      },
      resolution: { value: 0.5, unit: "degree" },
      temporalCoverage: { start: "2001-01-01", end: "2001-12-31" },
      inputVariables: [{ role: "precipitation", dataset: "test_precip" }],
      activeProcesses: [],
      outputVariables: [{ name: "discharge", fullName: "Discharge", unit: "m3/s" }],
      recommendedCompute: { cores: 16, walltime: "15:00" },
    },
    uses: {
      container: { image: "wbm", version: "2.0.0", digest: "sha256:fake", oras: "", https: "" },
      modelInput: { id: "fake-model-input-id" },
    },
    runtime: {
      generatedAt: "2026-01-01T00:00:00Z",
      execution: {
        cluster: "anvil",
        cores: 16,
        elapsedWalltime: "12:00",
        startedAt: "2026-01-01T00:00:00Z",
        finishedAt: "2026-01-01T00:12:00Z",
        slurmJobId: "12345",
      },
    },
    spatialResolutionDegrees: 0.5,
    licenseUrl: "https://spdx.org/licenses/GPL-3.0-only.html",
    generatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}
