// ─── Job status ──────────────────────────────────────────────────────────────

export type JobStatus =
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
  slurm_job_id: number | null;
  slurm_job_name: string;
  status: JobStatus;
  status_reason: string | null;
  parameters: JobParameters;
  slurm_config: SlurmConfig;
  created_at: string;
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
