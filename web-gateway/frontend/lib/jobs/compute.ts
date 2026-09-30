/**
 * What a draft asks SLURM for: cores and walltime (`SlurmConfig`), the
 * snapshot's own recommendation behind them, and how to show both.
 *
 * A snapshot's `recommendedCompute.walltime` is SLURM `--time` syntax, not
 * `HH:MM:SS`: `15:00` is fifteen minutes, `111:30:00` is over four days. The
 * backend passes it to SLURM as written, so this file reads it the way SLURM
 * does. A draft's own walltime is always `HH:MM:SS` (app/models/job.py).
 */
import { MAX_CORES, MAX_WALLTIME, type SlurmConfig } from "@/lib/jobs/types";

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
 *  to a whole second: `15:00` becomes `22:30`, `4:30:00` becomes `6:45:00`.
 *  This is what the backend asks SLURM for when a draft has no walltime of its
 *  own (`with_headroom` in app/services/job_script.py): the recommendation is
 *  what a run took, not what it is safe to ask for. Null if `value` is not a
 *  SLURM time. */
export function withHeadroom(value: string): string | null {
  const seconds = parseSlurmTime(value);
  return seconds === null ? null : formatSlurmTime(Math.ceil(seconds * 1.5));
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

/** A walltime in SLURM syntax, written for a person; unparseable values are
 *  shown as they are rather than hidden. */
export function describeSlurmTime(value: string): string {
  const seconds = parseSlurmTime(value);
  return seconds === null ? value : describeDuration(seconds);
}

export interface Recommended {
  cores: number;
  walltime: string;
}

/** The cores and walltime a submit will ask for, the same as the backend's
 *  `resolve_compute`: the draft's own, else the snapshot's recommendation.
 *  Cores are the recommendation as it is; the walltime is the recommendation
 *  plus 50% (`withHeadroom`), and a walltime the draft chose is used as given.
 *  `recommended` is null when the snapshot could not be loaded. `*Source` says
 *  which one answered ("snapshot" means the recommendation, with headroom for
 *  the walltime). */
export function effectiveCompute(
  config: SlurmConfig,
  recommended: Recommended | null
): {
  cores: number | null;
  coresSource: "draft" | "snapshot";
  walltime: string | null;
  walltimeSource: "draft" | "snapshot";
} {
  return {
    cores: config.cores ?? recommended?.cores ?? null,
    coresSource: config.cores !== null ? "draft" : "snapshot",
    walltime:
      config.walltime ?? (recommended ? withHeadroom(recommended.walltime) : null),
    walltimeSource: config.walltime !== null ? "draft" : "snapshot",
  };
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
    } else if (seconds <= 0 || seconds > 96 * 3600) {
      errors.walltime = `Use more than zero and at most ${MAX_WALLTIME}.`;
    }
  }
  return errors;
}

/** The PATCH payload for a draft's `slurm_config`: only what the user set.
 *  Null when both are unset, so nothing is sent and the snapshot's
 *  recommendation stays in force. */
export function slurmConfigPatch(config: SlurmConfig): Partial<SlurmConfig> | null {
  const patch: Partial<SlurmConfig> = {};
  if (config.cores !== null) patch.cores = config.cores;
  if (config.walltime !== null) patch.walltime = config.walltime;
  return Object.keys(patch).length > 0 ? patch : null;
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

/** Why a control is disabled: the submit route refuses these until the
 *  toolkit has an option for each (ADR 0025, open item 9). One line each, for
 *  the control's own explanation. */
export const UNSUPPORTED_REASON = {
  modelInput:
    "Not available yet: the toolkit has no option for it, so every run uses the snapshot's own model input.",
  spatialSubset:
    "Not available yet: the toolkit has no option for a subset, so every run covers the snapshot's whole domain.",
  customParams:
    "Not available yet: the toolkit has no option for custom parameters.",
} as const;

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
