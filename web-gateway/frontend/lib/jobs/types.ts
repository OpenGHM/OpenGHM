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

export interface SlurmConfig {
  partition: string | null;
  account: string | null;
  walltime: string | null;
  nodes: number | null;
  ntasks: number | null;
  memory: string | null;
}

// ─── `about` — a simulation's citation block, editable one field at a time
// while it is a DRAFT. Derived from the generated `OpenGHMCitationBlock`
// (rule 4) rather than restated — mirrors app/models/job.py's PartialAbout
// on the backend. ────────────────────────────────────────────────────────────

export type PartialAbout = Partial<OpenGHMCitationBlock>;

// ─── API models ──────────────────────────────────────────────────────────────

export interface JobStatsResponse {
  total: number;
  running: number;
  completed: number;
  failed: number;
}

export interface Job {
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
  slurm_job_id: number | null;
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
}

export interface JobListResponse {
  items: Job[];
  total_count: number;
  page: number;
  total_pages: number;
}

export interface JobSubmitRequest {
  dataset_id: string;
  parameters: JobParameters;
  slurm_config?: Partial<SlurmConfig>;
}

export interface JobSubmitResponse {
  job_id: string;
  status: JobStatus;
}

/** POST /jobs/derive/{dataset_id} body. */
export interface SimulationDeriveRequest {
  slug?: string | null;
  /** Optional model-input override, set at creation time instead of only
   *  by a later PATCH. Absent means inherit from the base snapshot, same
   *  as everywhere else this field appears (app/models/job.py). */
  model_input_id?: string | null;
}

/** PATCH /jobs/{job_id} body — only the fields supplied are changed.
 * Refused (409) once the simulation has moved past DRAFT. */
export interface SimulationUpdateRequest {
  slug?: string | null;
  about?: PartialAbout | null;
  parameters?: JobParameters | null;
  /** Set to override the base snapshot's model input, or explicitly to
   *  `null` to clear an override and go back to inheriting. Omitting the
   *  key entirely leaves whatever was there untouched. */
  model_input_id?: string | null;
}

export interface JobStatusResponse {
  job_id: string;
  sim_id: string | null;
  status: JobStatus;
  slurm_job_id: number | null;
  submitted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  status_reason: string | null;
}

export interface JobLogsResponse {
  job_id: string;
  stdout: string;
  stderr: string;
  truncated: boolean;
}
