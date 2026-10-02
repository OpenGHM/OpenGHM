/**
 * Fake data for the design preview and the tests.
 *
 * Everything a real run would produce is invented here: SLURM ids, timings,
 * stdout/stderr, output files, progress. The dev-only route
 * (`app/dev/workspace/[state]`, lib/workspace/preview.ts) renders it so every
 * status and every verdict cause can be looked at without making Anvil
 * produce it, and component tests build their inputs from it. No real page
 * imports this module, and none may: a real page shows what the backend says.
 *
 * What is *not* invented is shape. Simulations are `Job`, logs are
 * one string per stream, and any snapshot or model-input metadata comes from the
 * generated spec types. A field name that does not exist in the spec does not
 * exist here either, so the preview cannot drift from the real page.
 */
import type {
  FailureCause,
  Job,
  JobFailure,
  JobLive,
  JobStatus,
  LogStream,
  OutputManifest,
} from "@/lib/jobs/types";
import type { Dataset } from "@/lib/repository/types";

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
      : status === "RUNNING" || status === "COMPLETING"
        ? iso(258_000) // 4 min 18 s in, so the walltime bar has something to show
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
    slurm_state: null,
    slurm_exit_code: null,
    slurm_start: null,
    slurm_end: null,
    failure: null,
    cancel_requested_at: null,
    cancel_requested_by_email: null,
    files: null,
    output: null,
    ...overrides,
  };
}

// Placeholder paths: clearly not a real user's scratch.
const FAKE_WORK_DIR = "/scratch/example/openghm/out/sim-20260921-preview";
const FAKE_JOB_DIR = "/scratch/example/openghm/jobs/slurmly-0123456789ab";

const WBM_LOG_TAIL = [
  "Reading init: data_init/climate/merra2_prectotcorr_d.init",
  "Warping precipitation to the model grid",
  "Failed to warp /scratch/example/openghm/model_input/precip_2001.nc: out of memory",
].join("\n");

const STDERR_TAIL = [
  "openghm: cannot reach the model snapshot store: connection timed out",
  "openghm: 3 of 412 files failed",
].join("\n");

/** What each cause would leave on a job. Invented: the shape is `JobFailure`
 *  plus the SLURM fields that go with it, the words are not the real ones. */
const FAILURE_FIXTURES: Record<
  Exclude<FailureCause, "cancelled_by_user" | "cancelled_by_system">,
  { slurm_state: string; slurm_exit_code: string | null; failure: Omit<JobFailure, "cause"> }
> = {
  fetch_failed: {
    slurm_state: "FAILED",
    slurm_exit_code: "1:0",
    failure: {
      phase: "fetch",
      message: "Could not download 3 of 412 model snapshot files: inputs/precip_2001.nc, inputs/precip_2002.nc, inputs/tair_2001.nc",
      excerpt: STDERR_TAIL,
    },
  },
  run_refused: {
    slurm_state: "FAILED",
    slurm_exit_code: "2:0",
    failure: {
      phase: "run",
      message: "openghm: the model snapshot's init names a variable that is not in its output list",
      excerpt: "openghm: the model snapshot's init names a variable that is not in its output list\nopenghm: nothing was staged",
    },
  },
  wbm_error: {
    slurm_state: "FAILED",
    slurm_exit_code: "1:0",
    failure: {
      phase: "run",
      message: "WBM stopped with an error (exit code 1): cannot open data_init/climate/merra2_prectotcorr_d.init: No such file or directory",
      excerpt: [
        "Use of uninitialized value in numeric lt (<) at /wbm/model/wbm.pl line 2841.",
        "ERROR: cannot open data_init/climate/merra2_prectotcorr_d.init: No such file or directory",
        "  at /wbm/model/RIMS.pm line 1184.",
      ].join("\n"),
    },
  },
  wbm_silent_failure: {
    slurm_state: "COMPLETED",
    slurm_exit_code: "0:0",
    failure: {
      phase: "check",
      message: "WBM exited 0 but its log has no \"All Done!\" line",
      excerpt: WBM_LOG_TAIL,
    },
  },
  timeout: {
    slurm_state: "TIMEOUT",
    slurm_exit_code: "0:0",
    failure: {
      phase: "run",
      message: "The job hit its walltime of 00:15:00 while WBM was still running",
      excerpt: "  2001-08 .. done\n  2001-09 .. done\n  2001-10 ..",
    },
  },
  out_of_memory: {
    slurm_state: "OUT_OF_MEMORY",
    slurm_exit_code: "0:125",
    failure: {
      phase: "run",
      message: "The job ran out of memory and Anvil stopped it. Reduce what the simulation asks for or request more resources, then submit again.",
      excerpt: null,
    },
  },
  node_failure: {
    slurm_state: "NODE_FAIL",
    slurm_exit_code: "0:0",
    failure: {
      phase: null,
      message: "The node the job ran on failed",
      excerpt: null,
    },
  },
  lost: {
    slurm_state: "UNKNOWN",
    slurm_exit_code: null,
    failure: {
      phase: null,
      message: "SLURM has had no record of this job for 10 minutes and it left no result",
      excerpt: null,
    },
  },
  outcome_missing: {
    slurm_state: "COMPLETED",
    slurm_exit_code: "0:0",
    failure: {
      phase: null,
      message: "SLURM says the job completed, but it wrote no result record",
      excerpt: "slurmstepd: error: could not write to the job directory",
    },
  },
};

/** A small, plausible manifest: three variables at three time steps. */
function fakeOutput(): OutputManifest {
  const files: OutputManifest["files"] = [];
  for (const v of ["discharge", "runoff", "streamAge"]) {
    files.push({ path: `yearly/${v}_2001.nc`, bytes: 15_360_000 });
    files.push({ path: `monthly/${v}_2001.nc`, bytes: 184_320_000 });
    for (let d = 1; d <= 3; d++) {
      files.push({ path: `daily/${v}_2001_${String(d).padStart(3, "0")}.nc`, bytes: 61_440_000 });
    }
  }
  files.push({ path: "init.ini", bytes: 4_096 });
  return {
    nc_count: files.length - 1,
    file_count: files.length,
    total_bytes: files.reduce((n, f) => n + f.bytes, 0),
    files,
    truncated: false,
  };
}

/**
 * The fixture behind a preview state key (lib/workspace/preview.ts): a job with
 * the fields that state would really have — a failed one its verdict, a
 * finished one its directories on Anvil. `viewerEmail` is who is looking, so
 * "cancelled by you" can be shown as such.
 */
export function previewSimulation(
  key: string,
  { overrides = {}, viewerEmail = null }: { overrides?: Partial<Job>; viewerEmail?: string | null } = {}
): Job {
  const [kind, variant] = key.split(":");
  const onAnvil = { work_dir: FAKE_WORK_DIR, remote_job_dir: FAKE_JOB_DIR, files: "present" as const };
  const you = viewerEmail ?? "you@example.test";

  const build = (): Job => {
    if (kind === "cancelling") {
      return fakeSimulation("RUNNING", {
        work_dir: FAKE_WORK_DIR,
        remote_job_dir: FAKE_JOB_DIR,
        cancel_requested_at: iso(2 * 60_000),
        cancel_requested_by_email: you,
      });
    }

    if (kind === "completed") {
      const base = fakeSimulation("COMPLETED", {
        ...onAnvil,
        slurm_state: "COMPLETED",
        slurm_exit_code: "0:0",
        output: fakeOutput(),
      });
      if (variant === "purged") return { ...base, files: "purged" };
      if (variant === "legacy") {
        return { ...base, work_dir: null, remote_job_dir: null, files: null, output: null };
      }
      return base;
    }

    if (kind === "failed") {
      const cause = (variant ?? "wbm_error") as keyof typeof FAILURE_FIXTURES;
      const f = FAILURE_FIXTURES[cause] ?? FAILURE_FIXTURES.wbm_error;
      return fakeSimulation("FAILED", {
        ...onAnvil,
        slurm_state: f.slurm_state,
        slurm_exit_code: f.slurm_exit_code,
        failure: { cause, ...f.failure },
        status_reason: f.failure.message,
      });
    }

    if (kind === "cancelled") {
      const bySystem = variant === "system";
      return fakeSimulation("CANCELLED", {
        ...onAnvil,
        slurm_state: bySystem ? "CANCELLED by 8013088" : "CANCELLED by 2100",
        slurm_exit_code: "0:0",
        failure: {
          cause: bySystem ? "cancelled_by_system" : "cancelled_by_user",
          phase: "run",
          message: bySystem
            ? "SLURM cancelled the job and the gateway had no cancel request for it"
            : "Cancelled at the owner's request",
          excerpt: null,
        },
        cancel_requested_at: bySystem ? null : iso(90 * 60_000),
        cancel_requested_by_email: bySystem ? null : variant === "other" ? "colleague@example.test" : you,
      });
    }

    return fakeSimulation(kind.toUpperCase() as JobStatus);
  };

  return { ...build(), ...overrides };
}

/** A WBM log as a v2 run writes it (ADR 0027): one progress line per simulated
 *  day, `Spinup` then `File`, and "All Done!" at the end of a good run. */
function wbmLog({ days, done }: { days: number; done: boolean }): string {
  const lines = ["Reading init: wbm_init/wbm_test.init", "Loading network: hyd_5m_global.asc"];
  const balance = "Balance=(0.00,0.00,0.00,   8.20,  109.09,   0.81,  0.00, 0.00,0.00) Spool+=2";
  lines.push(`Spinup 1/1 (2000-12-31) ${balance}`);
  const start = Date.UTC(2001, 0, 1);
  for (let d = 0; d < days; d++) {
    const date = new Date(start + d * 86_400_000).toISOString().slice(0, 10);
    lines.push(`File wbm_2001.nc (${date}) ${balance}`);
  }
  if (done) lines.push("All Done!");
  return lines.join("\n");
}

/** The three logs a job in this state would have: `undefined` is a stream that
 *  was never written. */
export function fakeLogs(status: JobStatus): Partial<Record<LogStream, string>> {
  if (status === "FAILED") {
    return {
      wbm: wbmLog({ days: 62, done: false }),
      stdout: "openghm: staged 412 files\nopenghm: running wbm.pl",
      stderr: [
        "Use of uninitialized value in numeric lt (<) at /wbm/model/wbm.pl line 2841.",
        "ERROR: cannot open data_init/climate/merra2_prectotcorr_d.init: No such file or directory",
        "  at /wbm/model/RIMS.pm line 1184.",
        "wbm.pl exited with status 1",
      ].join("\n"),
    };
  }
  if (status === "COMPLETED") {
    return {
      wbm: wbmLog({ days: 365, done: true }),
      stdout: "openghm: staged 412 files\nopenghm: running wbm.pl\nopenghm: wrote 16 output files",
      stderr: undefined,
    };
  }
  if (status === "RUNNING" || status === "COMPLETING") {
    return {
      wbm: wbmLog({ days: 131, done: false }),
      stdout: "openghm: staged 412 files\nopenghm: running wbm.pl",
      stderr: undefined,
    };
  }
  return {};
}

/**
 * What SLURM would say about a job in this state (`live` of the status
 * answer, ADR 0027), for the dev preview: a queue reason while waiting, and the
 * walltime and WBM's simulated date while running. Times are relative to now,
 * so "checked 5 s ago" holds whenever the preview is opened.
 */
export function fakeLive(job: Job): JobLive | null {
  const checked_at = iso(5_000);
  if (job.status === "PENDING" || job.status === "SUBMITTED") {
    return {
      checked_at,
      queue_reason: job.status === "PENDING" ? "Priority" : null,
      estimated_start: null,
      time_limit_seconds: 1380,
      progress: null,
    };
  }
  if (job.status === "RUNNING" || job.status === "COMPLETING") {
    const { temporal_range_start: run_start, temporal_range_end: run_end } = job.parameters;
    const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
    const date = "2001-05-12";
    const fraction = (day(date) - day(run_start) + 1) / (day(run_end) - day(run_start) + 1);
    return {
      checked_at,
      queue_reason: null,
      estimated_start: null,
      time_limit_seconds: 1380,
      progress: {
        phase: "run",
        loop: null,
        loops: null,
        date,
        run_start,
        run_end,
        fraction,
        line: "File wbm_2001.nc (2001-05-12) Balance=(0.00,0.00,0.00,   8.20,  109.09,   0.81,  0.00, 0.00,0.00) Spool+=2",
        read_at: iso(5_000),
      },
    };
  }
  return null;
}

/**
 * A `Dataset` (published snapshot) for component tests — e.g.
 * `snapshot-grid.test.tsx`, `snapshot-picker.test.tsx`. This is the one
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
      description: "A model snapshot used only in tests.",
      datePublished: "2026-01-01T00:00:00Z",
      tags: ["test"],
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
