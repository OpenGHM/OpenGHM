import type { OpenGHMCitationBlock } from "@/lib/repository/generated";

// ─── Job status ──────────────────────────────────────────────────────────────

export type JobStatus =
  | "DRAFT"
  | "PENDING"
  | "SUBMITTED"
  | "RUNNING"
  | "COMPLETING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

const TERMINAL: Set<JobStatus> = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export function isTerminalStatus(s: JobStatus): boolean {
  return TERMINAL.has(s);
}

// ─── Verdict (ADR 0026) ──────────────────────────────────────────────────────

/** Why a job ended the way it did. The backend's `classify`
 *  (app/services/job_verdict.py) is the only place a cause is named; the words
 *  a user reads for each live in lib/workspace/failure-copy.ts. */
export type FailureCause =
  | "fetch_failed"
  | "run_refused"
  | "wbm_error"
  | "wbm_silent_failure"
  | "timeout"
  | "out_of_memory"
  | "node_failure"
  | "cancelled_by_user"
  | "cancelled_by_system"
  | "lost"
  | "outcome_missing";

/** Set on FAILED and CANCELLED. `excerpt` is the WBM log tail for the WBM
 *  causes and the stderr tail for the others. */
export interface JobFailure {
  cause: FailureCause;
  phase: string | null;
  message: string;
  excerpt: string | null;
}

/** `purged`: Anvil's 30-day scratch purge removed the run's work directory. */
export type FilesState = "present" | "purged";

export interface OutputFile {
  /** Relative to `work_dir`. */
  path: string;
  bytes: number;
}

/** What a COMPLETED job wrote, from the job's own outcome record. */
export interface OutputManifest {
  nc_count: number;
  total_bytes: number;
  file_count: number;
  files: OutputFile[];
  /** `files` was cut short; `file_count` is still the real total. */
  truncated: boolean;
}

/** What the verdict adds to a job. On both `Job` (GET /jobs/{id}) and
 *  `JobStatusResponse` (GET /jobs/{id}/status); every field is null until it
 *  applies. `work_dir` and `completed_at` are on both too, declared there. */
export interface JobVerdictFields {
  /** SLURM's own words, e.g. `COMPLETED`, `TIMEOUT`, `CANCELLED by 8013088`. */
  slurm_state: string | null;
  /** e.g. `0:0`, `1:0`. */
  slurm_exit_code: string | null;
  slurm_start: string | null;
  slurm_end: string | null;
  failure: JobFailure | null;
  /** Set when a cancel was asked for. The status stays non-terminal until
   *  SLURM confirms it. */
  cancel_requested_at: string | null;
  cancel_requested_by_email: string | null;
  files: FilesState | null;
  output: OutputManifest | null;
}

// ─── Value objects ───────────────────────────────────────────────────────────

export interface SpatialDomain {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface JobParameters {
  temporal_range_start: string;
  temporal_range_end: string;
  spatial_domain: SpatialDomain | null;
  variables: string[];
  custom_params: Record<string, string> | null;
}

// ─── The published answer to a draft ─────────────────────────────────────────

/** Which folder of the published run a file is in. */
export type PublishedFileGroup = "daily" | "monthly" | "yearly";

/** One published output file that answers a draft. `variable` is null for a
 *  daily file, which holds every published variable. `url` is public. */
export interface PublishedFile {
  group: PublishedFileGroup;
  variable: string | null;
  year: number;
  key: string;
  url: string;
  /** Bytes. */
  size: number;
}

/** Why a draft is not answered by its snapshot: a stable `code` and a plain
 *  `message`. */
export interface PublishedAnswerReason {
  code: string;
  message: string;
}

/** `POST /repository/datasets/{id}/published-answer`: whether the snapshot's
 *  own published output answers a draft, and the files that do. `reasons` is
 *  empty when `answered`, and `files` is empty when not. */
export interface PublishedAnswer {
  answered: boolean;
  reasons: PublishedAnswerReason[];
  period: { start: string; end: string } | null;
  run_id: string | null;
  files: PublishedFile[];
}

/** What a draft asks SLURM for. Both null means the snapshot's own
 *  `simulation.recommendedCompute`. The account and partition are the
 *  gateway's, not the user's (app/models/job.py). */
export interface SlurmConfig {
  cores: number | null;
  /** `HH:MM:SS` when the user chose it; a snapshot's own recommendation is
   *  never copied in here. */
  walltime: string | null;
}

/** The limits the backend enforces on a draft's `slurm_config`
 *  (`MAX_CORES`, `MAX_WALLTIME_SECONDS` in app/models/job.py). */
export const MAX_CORES = 128;
export const MAX_WALLTIME_SECONDS = 96 * 3600;
export const MAX_WALLTIME = "96:00:00";

/** The toolkit install a submitted job runs (ADR 0025). */
export interface ToolkitRef {
  home: string;
  commit: string;
}

/** Why the last submit of a draft did not reach SLURM. The draft stayed a
 *  draft. */
export interface SubmitError {
  code: string;
  message: string;
  at: string;
}

// ─── `about` — a snapshot draft's citation block, editable one field at a time
// while it is a DRAFT. Derived from the generated `OpenGHMCitationBlock`
// (rule 4) rather than restated — mirrors app/models/job.py's PartialAbout
// on the backend. ────────────────────────────────────────────────────────────

export type PartialAbout = Partial<OpenGHMCitationBlock>;

/** What a PATCH may send for `about`: the backend merges it key by key, and a
 *  key sent as `null` removes that key (app/api/v1/jobs.py, `update_simulation`). */
export type AboutUpdate = { [K in keyof PartialAbout]?: PartialAbout[K] | null };

// ─── API models ──────────────────────────────────────────────────────────────

/** GET /jobs/stats: one count per tab of the snapshot draft list, and the admin
 *  cards. `running` is every active status (pending, submitted, running,
 *  completing), so it is the Active tab's count. */
export interface JobStatsResponse {
  total: number;
  running: number;
  completed: number;
  failed: number;
  draft: number;
  cancelled: number;
}

export interface Job extends JobVerdictFields {
  id: string;
  sim_id: string;
  user_id: string;
  dataset_id: string;
  dataset_title: string;
  slug: string | null;
  about: PartialAbout | null;
  /** Set to run against an input other than the base snapshot's. Null means
   *  inherit — see `effective_model_input_state` for which case applies. */
  model_input_id: string | null;
  effective_model_input_id: string | null;
  /** `inherited-missing` means the base snapshot cites an input the
   *  catalogue does not hold, which is common in the shipped examples. */
  effective_model_input_state: "inherited" | "chosen" | "inherited-missing";
  slurm_job_id: string | null;
  slurm_job_name: string;
  status: JobStatus;
  status_reason: string | null;
  parameters: JobParameters;
  slurm_config: SlurmConfig;
  created_at: string;
  updated_at: string | null;
  submitted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  output_s3_key: string | null;
  /** Set once submitted: the toolkit it runs, its work directory on scratch,
   *  and the directory holding the batch script and its logs. */
  toolkit: ToolkitRef | null;
  work_dir: string | null;
  remote_job_dir: string | null;
  last_submit_error: SubmitError | null;
}

export interface JobListResponse {
  items: Job[];
  total_count: number;
  page: number;
  total_pages: number;
}

/** POST /jobs/derive/{dataset_id} body. */
export interface DraftDeriveRequest {
  slug?: string | null;
  /** Optional model-input override, set at creation time instead of only
   *  by a later PATCH. Absent means inherit from the base snapshot, same
   *  as everywhere else this field appears (app/models/job.py). */
  model_input_id?: string | null;
}

/** PATCH /jobs/{job_id} body — only the fields supplied are changed.
 * Refused (409) once the snapshot draft has moved past DRAFT. */
export interface DraftUpdateRequest {
  slug?: string | null;
  /** Merged key by key into the stored block; `null` for the whole block
   *  clears it. */
  about?: AboutUpdate | null;
  parameters?: JobParameters | null;
  /** Cores and walltime. Only the fields sent change; `null` goes back to
   *  the snapshot's recommended compute. */
  slurm_config?: Partial<SlurmConfig> | null;
  /** Set to override the base snapshot's model input, or explicitly to
   *  `null` to clear an override and go back to inheriting. Omitting the
   *  key entirely leaves whatever was there untouched. */
  model_input_id?: string | null;
}

/** Where a running WBM has got to, read from the last progress line of its
 *  log (ADR 0027). */
export interface JobProgress {
  phase: "spinup" | "run";
  /** Spin-up only: which loop of how many. */
  loop: number | null;
  loops: number | null;
  /** The simulated date WBM has reached, `YYYY-MM-DD`. */
  date: string;
  /** The job's own run range. */
  run_start: string | null;
  run_end: string | null;
  /** Run phase only, 0 to 1. A spin-up has none: its length is not known. */
  fraction: number | null;
  /** The WBM line it came from, at most 200 characters. */
  line: string;
  read_at: string;
}

/** What SLURM said about a live job at `checked_at` (ADR 0027). Not stored. */
export interface JobLive {
  checked_at: string;
  /** SLURM's reason a pending job waits, verbatim; null when it gave none. */
  queue_reason: string | null;
  /** Only when SLURM gives a real estimate. */
  estimated_start: string | null;
  /** The walltime SLURM enforces. */
  time_limit_seconds: number | null;
  progress: JobProgress | null;
}

export interface JobStatusResponse extends JobVerdictFields {
  job_id: string;
  sim_id: string | null;
  status: JobStatus;
  slurm_job_id: string | null;
  submitted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  status_reason: string | null;
  work_dir: string | null;
  /** Null for a draft or ended job, and before SLURM has ever answered. */
  live?: JobLive | null;
}

/** The three logs a job has: what WBM writes, and what SLURM captured. */
export type LogStream = "stdout" | "stderr" | "wbm";

/** GET /jobs/{id}/logs: the bytes `[offset, next_offset)` of one log. */
export interface JobLogChunk {
  job_id: string;
  stream: LogStream;
  /** False: the file is not there (yet, purged, or no job directory). */
  exists: boolean;
  data: string;
  offset: number;
  next_offset: number;
  size: number;
  eof: boolean;
}

/**
 * What a Workspace server action returns instead of throwing on the failures
 * a screen must handle:
 * - `session_expired`: the backend answered 401. Show SessionExpiredBanner.
 * - `not_found`: the job is missing, or is not yours (the backend answers 404
 *   for both, ADR 0024).
 * - `error`: anything else; `message` is safe to show (the backend's `detail`
 *   when it sent one, or `detail.message` for the `{ code, message }` of the
 *   submit gates' 403 and 429, and of the submit route's own answers). `code`
 *   is that machine-readable code, if any.
 */
export type ActionFailure =
  | { ok: false; reason: "session_expired" }
  | { ok: false; reason: "not_found" }
  | {
      ok: false;
      reason: "error";
      message: string;
      status?: number;
      code?: string;
      /** The fields a refusal names: those of an `unsupported_fields` answer
       *  (`parameters.spatial_domain`), or the dotted paths of a validation
       *  error (`slurm_config.walltime`). */
      fields?: string[];
      /** A `run_start_not_aligned` refusal's nearest allowed start. */
      suggestedStart?: string | null;
    };

export type ActionResult<T> = { ok: true; data: T } | ActionFailure;
