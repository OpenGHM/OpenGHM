import type { UserRole } from "@/lib/auth.types";

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  organization: string | null;
  email_verified: boolean;
  is_active: boolean;
  /** ADR 0024: lets a role `user` submit a simulation. Admin and staff are
   *  always permitted and a guest never is, whatever this says. */
  can_run_simulations: boolean;
  created_at: string | null;
}

export interface UserListResponse {
  items: AdminUser[];
  total_count: number;
  page: number;
  total_pages: number;
}

/** Mirrors web-gateway/backend/app/core/audit.py:AuditCategory. */
export type AuditCategory = "auth" | "job";

export interface AuditLogEntry {
  id: string;
  action: string;
  category: AuditCategory;
  actor_id: string;
  actor_email: string | null;
  target_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditLogListResponse {
  items: AuditLogEntry[];
  total_count: number;
  page: number;
  total_pages: number;
}

export interface AdminUserDetail extends AdminUser {
  updated_at: string | null;
  sso_provider: string | null;
  active_session_count: number;
  job_counts: Record<string, number>;
  last_login_at: string | null;
}

export interface TimeSeriesPoint {
  bucket: string;
  count: number;
}

export interface TimeSeriesResponse {
  metric: string;
  granularity: string;
  timezone: string;
  start: string;
  end: string;
  total: number;
  points: TimeSeriesPoint[];
}

export interface StatusCount {
  status: string;
  count: number;
}

export interface StatusBreakdownResponse {
  items: StatusCount[];
  total: number;
  since: string | null;
}

export type DependencyStatus = "ok" | "degraded" | "unconfigured" | "error";

export interface DependencyHealth {
  name: string;
  status: DependencyStatus;
  detail: string | null;
  latency_ms: number | null;
}

export interface FeatureStatus {
  name: string;
  configured: boolean;
  note: string | null;
}

export interface RuntimeSettingsSummary {
  jwt_expire_minutes: number;
  refresh_token_expire_days: number;
  job_default_walltime: string;
  job_default_nodes: number;
  job_default_ntasks: number;
  job_background_sync_interval: number;
  anvil_host: string;
  anvil_partition: string;
  anvil_execution_profile: string;
  s3_bucket: string;
  cors_origins: string[];
}

export interface SystemInfoResponse {
  environment: string;
  project_name: string;
  version: string;
  server_time: string;
  uptime_seconds: number;
  dependencies: DependencyHealth[];
  features: FeatureStatus[];
  settings: RuntimeSettingsSummary;
}
