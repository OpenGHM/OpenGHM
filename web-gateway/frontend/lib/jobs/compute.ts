/**
 * What a draft asks SLURM for: the cores (`SlurmConfig`), the snapshot's own
 * recommendation behind them, and how long a run is estimated to take. The
 * walltime is never the user's: it is the snapshot's recommendation with
 * headroom, and the run as a whole is held to `MAX_RUN_SECONDS`.
 *
 * A snapshot's `recommendedCompute.walltime` is SLURM `--time` syntax, not
 * `HH:MM:SS`: `15:00` is fifteen minutes, `111:30:00` is over four days. The
 * backend passes it to SLURM as written, so this file reads it the way SLURM
 * does.
 */
import {
  MAX_CORES,
  MAX_RUN_SECONDS,
  MAX_WALLTIME_SECONDS,
  type PostProcessingChoice,
  type SlurmConfig,
} from "@/lib/jobs/types";

/** Seconds in a SLURM `--time` value, or null if it is not one. Accepts
 *  `M`, `M:S`, `H:M:S`, `D-H`, `D-H:M` and `D-H:M:S`. */
export function parseSlurmTime(value: string): number | null {
  const m = /^(?:(\d+)-)?(\d+)(?::(\d{1,2}))?(?::(\d{1,2}))?$/.exec(value.trim());
  if (!m) return null;
  const days = m[1] !== undefined ? Number(m[1]) : null;
  const a = Number(m[2]);
  const b = m[3] !== undefined ? Number(m[3]) : null;
  const c = m[4] !== undefined ? Number(m[4]) : null;
  if (days !== null) {
    // D-H[:M[:S]]
    return days * 86400 + a * 3600 + (b ?? 0) * 60 + (c ?? 0);
  }
  if (b === null) return a * 60; // M
  if (c === null) return a * 60 + b; // M:S
  return a * 3600 + b * 60 + c; // H:M:S
}

/** `M:SS` under an hour, `H:MM:SS` from an hour up — SLURM's format, as the
 *  backend's `format_slurm_time` writes it. */
export function formatSlurmTime(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** A snapshot's recommended walltime plus 50%, in SLURM's format, rounded up
 *  to a whole second and never over what one job may use
 *  (`MAX_WALLTIME_SECONDS`): `15:00` becomes `22:30`, `4:30:00` becomes
 *  `6:45:00`, `80:00:00` becomes `96:00:00`. This is what the backend asks
 *  SLURM for (`with_headroom` in app/services/job_script.py): the
 *  recommendation is what a simulation took, not what it is safe to ask for. Null if
 *  `value` is not a SLURM time. */
export function withHeadroom(value: string): string | null {
  const seconds = parseSlurmTime(value);
  if (seconds === null) return null;
  return formatSlurmTime(Math.min(Math.ceil(seconds * 1.5), MAX_WALLTIME_SECONDS));
}

/** Whether a run will post-process: the draft asks for `climatology`, or asks
 *  nothing (`choice` null) and the snapshot's own init does (`own`, the
 *  dataset's `postProcessing`; null, absent or `none` count as not). The one
 *  rule every walltime a draft is shown with shares, as `runs_climatology` in
 *  app/services/job_script.py is for the backend's. */
export function runsClimatology(
  choice: PostProcessingChoice | null | undefined,
  own: string | null | undefined
): boolean {
  return (choice ?? own) === "climatology";
}

/** The snapshot's measured post-processing time in seconds, or null when it
 *  has none (`postProcessingWalltime` absent, or not a SLURM time). */
export function postProcessingSeconds(recommended: Recommended | null): number | null {
  return recommended?.postProcessingWalltime ? parseSlurmTime(recommended.postProcessingWalltime) : null;
}

/** The snapshot's recommended walltime, in seconds and without headroom: when
 *  the run `postProcessing` it is the walltime plus the measured post-processing
 *  time (the walltime alone when that was not measured), as
 *  `recommended_walltime` in app/services/job_script.py. Null when there is no
 *  recommendation or it is not a SLURM time. */
export function recommendedSeconds(recommended: Recommended | null, postProcessing = false): number | null {
  if (!recommended) return null;
  const run = parseSlurmTime(recommended.walltime);
  if (run === null) return null;
  return run + (postProcessing ? (postProcessingSeconds(recommended) ?? 0) : 0);
}

/** "15 min", "22 min 30 s", "2 h 30 min", "4 d 15 h" — for a person, not for
 *  SLURM. Seconds are shown when there are any and the value is under an hour. */
export function describeDuration(total: number): string {
  if (total < 60) return `${total} s`;
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

/** "111 h 30 min", "4 h", "22 min 30 s": hours however long it is, the way the
 *  limit is written (`describe_hours` in app/services/job_script.py). */
export function describeHours(total: number): string {
  const hours = Math.floor(total / 3600);
  if (hours === 0) return describeDuration(total);
  const minutes = Math.floor((total % 3600) / 60);
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

/** A walltime in SLURM syntax, written for a person; unparseable values are
 *  shown as they are rather than hidden. */
export function describeSlurmTime(value: string): string {
  const seconds = parseSlurmTime(value);
  return seconds === null ? value : describeDuration(seconds);
}

export interface Recommended {
  cores: number;
  walltime: string;
  /** How long the post-processing took on the reference period, measured like
   *  `walltime`; absent means it was not measured. */
  postProcessingWalltime?: string;
}

/** The post-processing part of a run's recommended time, in seconds: 0 when the
 *  run does not post-process or its time was not measured. */
export function postProcessingShare(recommended: Recommended | null, postProcessing: boolean): number {
  return postProcessing ? (postProcessingSeconds(recommended) ?? 0) : 0;
}

/** How long a run is estimated to take, in seconds: the snapshot's recommended
 *  time (with the post-processing time when the run `postProcessing`s,
 *  `recommendedSeconds`) as it is: no headroom, and not capped at what one job
 *  may use. This is what `MAX_RUN_SECONDS` is held against, as
 *  `estimated_run_seconds` in app/services/job_script.py. The slack for a run's
 *  uncertainty is already in the jobs the limit allows (4 x 96 h); the 50%
 *  (`withHeadroom`) belongs only to what one job asks SLURM for. Null when the
 *  snapshot is unknown or its value is not a time (the backend decides). */
export function estimatedRunSeconds(recommended: Recommended | null, postProcessing = false): number | null {
  return recommendedSeconds(recommended, postProcessing);
}

/** The estimated run time (`estimatedRunSeconds`) when it is over the limit for
 *  one simulation (`MAX_RUN_SECONDS`), else null: a submit refuses it
 *  (`run_over_limit` in app/api/v1/jobs.py). */
export function runOverLimit(recommended: Recommended | null, postProcessing = false): number | null {
  const seconds = estimatedRunSeconds(recommended, postProcessing);
  return seconds !== null && seconds > MAX_RUN_SECONDS ? seconds : null;
}

/** What to tell a person when `runOverLimit` applies: how long it is estimated
 *  to take and why. The estimate is the snapshot's reference run, so the run
 *  period does not change it; the one thing to drop is the post-processing,
 *  said only when the run alone would fit. The same sentence as the backend's
 *  `run_over_limit` refusal. */
export function describeRunOverLimit(
  seconds: number,
  recommended: Recommended | null,
  postProcessing = false
): string {
  const includesPostProcessing = postProcessingShare(recommended, postProcessing) > 0;
  const weeks = MAX_RUN_SECONDS / (7 * 24 * 3600);
  const advice =
    includesPostProcessing && runOverLimit(recommended, false) === null
      ? " Turn post-processing off to run it."
      : "";
  return (
    `This simulation is estimated to take about ${describeHours(seconds)} ` +
    `(the reference run${includesPostProcessing ? " and its post-processing" : ""}), ` +
    `over the ${weeks}-week limit for one simulation.${advice}`
  );
}

/** Memory SLURM gives one core on Anvil's `shared` partition, in MB. Verified
 *  on Anvil on 2026-10-02: `scontrol show partition shared` reports
 *  `DefMemPerCPU=1896` and `MaxMemPerCPU=1896`, and `sacct` for a 1-core run
 *  that SLURM killed (`OUT_OF_MEMORY`) shows `ReqMem` 1896M. So memory comes
 *  only with cores: a job cannot ask for more per core. That is why the
 *  snapshot recommends a core count at all: WBM itself uses about one CPU, and
 *  the cores are there for the memory.
 *
 *  This is the `shared` partition only, which is where the gateway submits
 *  (`ANVIL_PARTITION` in web-gateway/backend/app/core/config.py). It is advice
 *  for `describeCoresBelowRecommended`, not a rule: the backend does not enforce
 *  it. It only quotes the same figure (`ANVIL_SHARED_MB_PER_CORE` in its
 *  app/services/job_verdict.py) in the failure message of a simulation that ran
 *  out of memory; if Anvil changes it, change both. */
export const ANVIL_SHARED_MB_PER_CORE = 1896;

/** Memory for `cores` cores on the shared partition, in GB (1 GB = 1000 MB)
 *  with one decimal: `1.9`, `121.3`. Taken from the total in MB, not from the
 *  rounded per-core figure, so 64 cores read 121.3 and not 121.6. */
export function sharedMemoryGb(cores: number): string {
  return ((cores * ANVIL_SHARED_MB_PER_CORE) / 1000).toFixed(1);
}

/** A hint for a draft whose cores are below the number the snapshot
 *  recommends, or null. Memory on the shared partition comes with the cores
 *  (`ANVIL_SHARED_MB_PER_CORE`), so fewer cores than recommended may not give
 *  the simulation enough memory. It is not an error and blocks nothing: a smaller
 *  run period or domain may fit. Null when the draft leaves cores to the
 *  recommendation, when the snapshot has none, when cores are at or above it,
 *  and when they are not a whole number from 1 (`validateSlurmConfig` says so
 *  instead). */
export function describeCoresBelowRecommended(
  config: SlurmConfig,
  recommended: Recommended | null
): string | null {
  const cores = config.cores;
  if (cores === null || !recommended || !Number.isInteger(cores) || cores < 1) return null;
  if (!Number.isInteger(recommended.cores) || cores >= recommended.cores) return null;
  return (
    `This model snapshot recommends ${recommended.cores} cores, enough memory for its simulation. ` +
    `On Anvil's shared partition memory comes with cores, about ${sharedMemoryGb(1)} GB each, ` +
    `so ${recommended.cores} cores gives about ${sharedMemoryGb(recommended.cores)} GB ` +
    `and ${cores} ${cores === 1 ? "core" : "cores"} only about ${sharedMemoryGb(cores)} GB: ` +
    `the simulation may be stopped for running out of memory.`
  );
}

/** `describeCoresBelowRecommended` in one line, for under the field. Null in the
 *  same cases. The arithmetic behind it is the long form's. */
export function describeCoresBelowRecommendedShort(
  config: SlurmConfig,
  recommended: Recommended | null
): string | null {
  if (describeCoresBelowRecommended(config, recommended) === null || !recommended) return null;
  const cores = config.cores as number;
  return `${cores} ${cores === 1 ? "core is" : "cores are"} below the recommended ${recommended.cores}: the simulation may run out of memory.`;
}

/** What an automatic time is, in a few words after the value: the
 *  recommendation (plus the post-processing time when the run has it,
 *  `includesPostProcessing`) plus 50%. `placeholder` is the short form. */
export function automaticWalltimeLabel(
  form: "placeholder" | "summary" = "summary",
  includesPostProcessing = false
): string {
  const base = form === "placeholder" ? "recommended" : "model snapshot's recommendation";
  return includesPostProcessing ? `${base} + post-processing + 50%` : `${base} + 50%`;
}

/** What the estimated run time is, in a few words after the value: the
 *  snapshot's recommendation, plus the post-processing time when the run has it
 *  (`includesPostProcessing`). No headroom (`estimatedRunSeconds`). */
export function estimatedRunLabel(includesPostProcessing = false): string {
  return includesPostProcessing
    ? "model snapshot's recommendation + post-processing"
    : "model snapshot's recommendation";
}

/** The cores and the per-job walltime a submit will ask for, the same as the
 *  backend's `resolve_compute`: the draft's cores, else the snapshot's
 *  recommendation; the walltime is always the recommendation (plus the measured
 *  post-processing time when the run `postProcessing`s, `recommendedSeconds`)
 *  plus 50% (`withHeadroom`, at most the limit for one job). `recommended` is
 *  null when the snapshot could not be loaded. `coresSource` says which one
 *  answered; `walltimeCapped` says the walltime was cut to the limit for one
 *  job; `includesPostProcessing` says it has the post-processing time in it. */
export function effectiveCompute(
  config: SlurmConfig,
  recommended: Recommended | null,
  postProcessing = false
): {
  cores: number | null;
  coresSource: "draft" | "snapshot";
  walltime: string | null;
  walltimeCapped: boolean;
  includesPostProcessing: boolean;
} {
  const reference = recommendedSeconds(recommended, postProcessing);
  const walltime = reference !== null ? withHeadroom(formatSlurmTime(reference)) : null;
  return {
    cores: config.cores ?? recommended?.cores ?? null,
    coresSource: config.cores !== null ? "draft" : "snapshot",
    walltime,
    walltimeCapped: reference !== null && Math.ceil(reference * 1.5) > MAX_WALLTIME_SECONDS,
    includesPostProcessing: postProcessing && postProcessingSeconds(recommended) !== null,
  };
}

export interface ComputeErrors {
  cores?: string;
}

/** The same bounds the backend enforces on a PATCH (`SlurmConfigUpdate`), so
 *  a value is refused where it is typed rather than after a round trip. */
export function validateSlurmConfig(config: SlurmConfig): ComputeErrors {
  const errors: ComputeErrors = {};
  if (config.cores !== null) {
    if (!Number.isInteger(config.cores) || config.cores < 1 || config.cores > MAX_CORES) {
      errors.cores = `Use a whole number from 1 to ${MAX_CORES}.`;
    }
  }
  return errors;
}

/** Why a signed-in user cannot submit, in words for them, or null when they
 *  can (or when their profile could not be read, and the backend will
 *  decide). Mirrors `require_submitter` (ADR 0024): the backend checks the
 *  database, and this only explains it before the click. */
export function submitBlockedReason(
  profile: {
    role: string;
    is_active: boolean;
    email_verified: boolean;
    can_run_simulations: boolean;
  } | null
): string | null {
  if (profile === null) return null;
  if (!profile.is_active) {
    return "Your account has been deactivated. Contact an administrator.";
  }
  if (!profile.email_verified) {
    return "Verify your email address to run simulations. Check your inbox for the link.";
  }
  const exempt = profile.role === "admin" || profile.role === "staff";
  if (!exempt && !(profile.role === "user" && profile.can_run_simulations)) {
    return "Ask an administrator to allow you to run simulations. You can still prepare and save drafts.";
  }
  return null;
}

/** The fields an `unsupported_fields` refusal names, as a user knows them. */
export function describeUnsupportedField(field: string): string {
  switch (field) {
    case "model_input_id":
      return "a different model input";
    case "parameters.spatial_domain":
      return "a spatial subset";
    case "parameters.custom_params":
      return "custom parameters";
    default:
      return field;
  }
}
