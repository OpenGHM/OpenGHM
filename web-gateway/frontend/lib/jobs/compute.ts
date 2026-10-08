/**
 * What a draft asks SLURM for: cores and walltime (`SlurmConfig`), the
 * snapshot's own recommendation behind them, and how to show both.
 *
 * A snapshot's `recommendedCompute.walltime` is SLURM `--time` syntax, not
 * `HH:MM:SS`: `15:00` is fifteen minutes, `111:30:00` is over four days. The
 * backend passes it to SLURM as written, so this file reads it the way SLURM
 * does. A draft's own walltime is always `HH:MM:SS` (app/models/job.py).
 */
import {
  MAX_CORES,
  MAX_WALLTIME,
  MAX_WALLTIME_SECONDS,
  type PostProcessingChoice,
  type SlurmConfig,
} from "@/lib/jobs/types";

const HMS = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/;

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

/** `HH:MM:SS`, the form a draft stores. Hours are not capped at 24. */
export function secondsToHms(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
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
 *  to a whole second and never over what one job may use (`MAX_WALLTIME`):
 *  `15:00` becomes `22:30`, `4:30:00` becomes `6:45:00`, `80:00:00` becomes
 *  `96:00:00`. This is what the backend asks SLURM for when a draft has no
 *  walltime of its own (`with_headroom` in app/services/job_script.py): the
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
 *  rule the walltime a draft is shown and the over-limit check share, as
 *  `runs_climatology` in app/services/job_script.py is for the backend's. */
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

/** The snapshot's recommended walltime in seconds, when a submit of a draft
 *  with this `walltime` would have to ask for more than one job may use: the
 *  draft has none of its own and the recommendation alone is over the limit.
 *  When the run `postProcessing` the recommendation includes the measured
 *  post-processing time (`recommendedSeconds`). Null otherwise, and when the
 *  snapshot is unknown or its value is not a time (the backend decides). The
 *  same rule as `walltime_over_limit` in app/services/job_script.py, which
 *  refuses the submit. */
export function walltimeOverLimit(
  config: SlurmConfig,
  recommended: Recommended | null,
  postProcessing = false
): number | null {
  if (config.walltime !== null) return null;
  const seconds = recommendedSeconds(recommended, postProcessing);
  return seconds !== null && seconds > MAX_WALLTIME_SECONDS ? seconds : null;
}

/** The post-processing part of `walltimeOverLimit`'s seconds, to say so: 0 when
 *  the run does not post-process or its time was not measured. */
export function postProcessingShare(recommended: Recommended | null, postProcessing: boolean): number {
  return postProcessing ? (postProcessingSeconds(recommended) ?? 0) : 0;
}

/** What to tell a person when `walltimeOverLimit` applies: why, and what to do.
 *  `postProcessing` is the part of `seconds` the post-processing takes
 *  (`postProcessingShare`), which the sentence names when there is one. */
export function describeWalltimeOverLimit(seconds: number, postProcessing = 0): string {
  const limit = MAX_WALLTIME_SECONDS / 3600;
  if (postProcessing > 0) {
    return `This model snapshot's reference simulation took about ${describeHours(seconds - postProcessing)}, and its post-processing about ${describeHours(postProcessing)} more: more than the ${limit} h one job may use. Shorten the run period, choose the daily, monthly and yearly output instead of climatology, or set a walltime yourself (the simulation may be stopped when time runs out).`;
  }
  return `This model snapshot's reference simulation took about ${describeHours(seconds)}, more than the ${limit} h one job may use. Shorten the run period, or set a walltime yourself (the simulation may be stopped when time runs out).`;
}

/** `describeWalltimeOverLimit` in one line, for under the field: the facts, and
 *  the way out. The reason it matters ("the simulation may be stopped") is the long
 *  form's, offered beside it. */
export function describeWalltimeOverLimitShort(seconds: number, postProcessing = 0): string {
  const limit = MAX_WALLTIME_SECONDS / 3600;
  if (postProcessing > 0) {
    return `The reference simulation and its post-processing took about ${describeHours(seconds)} together, more than the ${limit} h one job may use. Shorten the run period, choose the standard output or set a walltime.`;
  }
  return `The reference simulation took about ${describeHours(seconds)}, more than the ${limit} h one job may use. Shorten the run period or set a walltime.`;
}

/** A softer hint for a walltime the draft chose that is shorter than the
 *  reference simulation took (with its post-processing, when the run
 *  `postProcessing`s), or null. It does not block anything: a shorter run
 *  period needs less time. */
export function describeWalltimeBelowReference(
  config: SlurmConfig,
  recommended: Recommended | null,
  postProcessing = false
): string | null {
  if (config.walltime === null || !recommended) return null;
  const chosen = HMS.exec(config.walltime);
  const reference = recommendedSeconds(recommended, postProcessing);
  if (!chosen || reference === null) return null;
  const seconds = Number(chosen[1]) * 3600 + Number(chosen[2]) * 60 + Number(chosen[3]);
  if (seconds <= 0 || seconds >= reference) return null;
  const took = postProcessingShare(recommended, postProcessing) > 0 ? "reference simulation and its post-processing took" : "reference simulation took";
  return `The model snapshot's ${took} about ${describeHours(reference)}. If this simulation needs longer than your walltime, it may be stopped when time runs out.`;
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
 *  for `describeCoresBelowRecommended`, not a rule: the backend does not know it
 *  and does not enforce it. Nothing else depends on it; if Anvil changes the
 *  figure, change it here. */
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

/** What the automatic walltime is, in a few words after the value: the
 *  recommendation (plus the post-processing time when the run has it,
 *  `includesPostProcessing`) plus 50%, or the limit for one job when that is
 *  more. `placeholder` is the short form for an input's placeholder. */
export function automaticWalltimeLabel(
  capped: boolean,
  form: "placeholder" | "summary" = "summary",
  includesPostProcessing = false
): string {
  if (capped) return "the limit for one job";
  const base = form === "placeholder" ? "recommended" : "model snapshot's recommendation";
  return includesPostProcessing ? `${base} + post-processing + 50%` : `${base} + 50%`;
}

/** The cores and walltime a submit will ask for, the same as the backend's
 *  `resolve_compute`: the draft's own, else the snapshot's recommendation.
 *  Cores are the recommendation as it is; the walltime is the recommendation
 *  (plus the measured post-processing time when the run `postProcessing`s,
 *  `recommendedSeconds`) plus 50% (`withHeadroom`, at most the limit for one
 *  job), and a walltime the draft chose is used as given. `recommended` is null
 *  when the snapshot could not be loaded. `*Source` says which one answered
 *  ("snapshot" means the recommendation, with headroom for the walltime);
 *  `walltimeCapped` says the automatic walltime was cut to the limit;
 *  `includesPostProcessing` says the automatic walltime has the post-processing
 *  time in it. */
export function effectiveCompute(
  config: SlurmConfig,
  recommended: Recommended | null,
  postProcessing = false
): {
  cores: number | null;
  coresSource: "draft" | "snapshot";
  walltime: string | null;
  walltimeSource: "draft" | "snapshot";
  walltimeCapped: boolean;
  includesPostProcessing: boolean;
} {
  const reference = recommendedSeconds(recommended, postProcessing);
  const automatic = reference !== null ? withHeadroom(formatSlurmTime(reference)) : null;
  return {
    cores: config.cores ?? recommended?.cores ?? null,
    coresSource: config.cores !== null ? "draft" : "snapshot",
    walltime: config.walltime ?? automatic,
    walltimeSource: config.walltime !== null ? "draft" : "snapshot",
    walltimeCapped:
      config.walltime === null && reference !== null && Math.ceil(reference * 1.5) > MAX_WALLTIME_SECONDS,
    includesPostProcessing:
      config.walltime === null && postProcessing && postProcessingSeconds(recommended) !== null,
  };
}

/**
 * What a draft asks SLURM for, in one line for a person: `Recommended: 26 cores
 * · 4 d (limit for one job)` when it leaves both to the snapshot, `Custom: 8
 * cores · 12 h` when it sets either. In a custom line a part it did not set is
 * marked (`4 d (recommended + 50%)`), so the line reads as what will be asked.
 * `custom` says which. The numbers are `effectiveCompute`'s, the backend's own.
 */
export function describeComputeSummary(
  config: SlurmConfig,
  recommended: Recommended | null,
  postProcessing = false
): { custom: boolean; text: string } {
  const effective = effectiveCompute(config, recommended, postProcessing);
  const custom = config.cores !== null || config.walltime !== null;
  const cores =
    effective.cores === null ? null : `${effective.cores} ${effective.cores === 1 ? "core" : "cores"}`;
  const walltime = effective.walltime === null ? null : describeSlurmTime(effective.walltime);
  const automaticWalltime = effective.walltimeCapped
    ? "limit for one job"
    : automaticWalltimeLabel(false, "placeholder", effective.includesPostProcessing);

  if (!custom) {
    if (cores === null || walltime === null) return { custom, text: "Recommended: set by the model snapshot" };
    return {
      custom,
      text: `Recommended: ${cores} · ${walltime}${effective.walltimeCapped ? " (limit for one job)" : ""}`,
    };
  }
  const parts = [
    cores === null ? null : effective.coresSource === "draft" ? cores : `${cores} (recommended)`,
    walltime === null ? null : effective.walltimeSource === "draft" ? walltime : `${walltime} (${automaticWalltime})`,
  ].filter((part): part is string => part !== null);
  return { custom, text: `Custom: ${parts.join(" · ")}` };
}

export interface ComputeErrors {
  cores?: string;
  walltime?: string;
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
  if (config.walltime !== null) {
    const m = HMS.exec(config.walltime);
    const seconds = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
    if (!m) {
      errors.walltime = "Use hours:minutes:seconds, for example 02:00:00.";
    } else if (seconds <= 0 || seconds > MAX_WALLTIME_SECONDS) {
      errors.walltime = `Use more than zero and at most ${MAX_WALLTIME}.`;
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
