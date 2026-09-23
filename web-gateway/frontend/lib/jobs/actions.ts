"use server";

import { getApiClient } from "@/lib/api-client";
import type {
  Job,
  JobListResponse,
  JobLogsResponse,
  JobStatsResponse,
  JobStatusResponse,
  JobSubmitRequest,
  JobSubmitResponse,
  SimulationDeriveRequest,
  SimulationUpdateRequest,
} from "@/lib/jobs/types";

/**
 * Submit a new simulation job.
 */
export async function submitJob(
  request: JobSubmitRequest
): Promise<JobSubmitResponse> {
  const client = await getApiClient();
  const res = await client.post<JobSubmitResponse>("/api/v1/jobs", request);
  return res.data;
}

/**
 * Fetch a job list (paginated). Defaults to the authenticated user's own
 * jobs; pass userId="*" for the site-wide list or a specific user id to
 * scope to them — both require Permission.JOB_VIEW_ANY server-side (see
 * web-gateway/backend/app/api/v1/jobs.py's _job_scope_query), used by /admin/jobs.
 */
export async function fetchJobs(
  page: number = 1,
  status?: string,
  userId?: string
): Promise<JobListResponse> {
  const client = await getApiClient();
  const params: Record<string, string | number> = { page, page_size: 10 };
  if (status) params.status = status;
  if (userId) params.user_id = userId;
  const res = await client.get<JobListResponse>("/api/v1/jobs", { params });
  return res.data;
}

/**
 * Create a new DRAFT simulation pre-filled from a published snapshot
 * (T4/T9) — the only creation path for a simulation short of the existing
 * immediate-submit flow. The source dataset is only ever read.
 */
export async function deriveSimulation(
  datasetId: string,
  request: SimulationDeriveRequest = {}
): Promise<Job> {
  const client = await getApiClient();
  const res = await client.post<Job>(
    `/api/v1/jobs/derive/${encodeURIComponent(datasetId)}`,
    request
  );
  return res.data;
}

/**
 * Edit a simulation while it is still a DRAFT. The backend returns 409
 * once the status has moved past DRAFT — callers should check
 * `job.status` before offering the control rather than relying on this
 * throwing.
 */
export async function updateSimulation(
  jobId: string,
  request: SimulationUpdateRequest
): Promise<Job> {
  const client = await getApiClient();
  const res = await client.patch<Job>(
    `/api/v1/jobs/${encodeURIComponent(jobId)}`,
    request
  );
  return res.data;
}

/**
 * Fetch a single job by ID.
 */
export async function fetchJob(jobId: string): Promise<Job | null> {
  try {
    const client = await getApiClient();
    const res = await client.get<Job>(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
    return res.data;
  } catch (error: unknown) {
    const axiosError = error as { response?: { status?: number } };
    // The existing (non-draft) job routes return 403 for a non-owner
    // rather than 404 — a different contract than the new draft routes,
    // which use 404 to avoid leaking existence. Not reconciled here (see
    // docs/reference/open-items.md); treated the same as "not found" so
    // visiting someone else's job from the Workspace table degrades to
    // the page's normal notFound() instead of an unhandled error.
    const status = axiosError?.response?.status;
    if (status === 404 || status === 403) return null;
    throw error;
  }
}

/**
 * Poll a job's latest status (lightweight endpoint).
 */
export async function pollJobStatus(
  jobId: string
): Promise<JobStatusResponse> {
  const client = await getApiClient();
  const res = await client.get<JobStatusResponse>(
    `/api/v1/jobs/${encodeURIComponent(jobId)}/status`
  );
  return res.data;
}

/**
 * Cancel a running/pending job.
 */
export async function cancelJob(
  jobId: string
): Promise<JobStatusResponse> {
  const client = await getApiClient();
  const res = await client.post<JobStatusResponse>(
    `/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`
  );
  return res.data;
}

/**
 * Fetch stdout/stderr logs for a job.
 */
export async function fetchJobLogs(
  jobId: string
): Promise<JobLogsResponse> {
  const client = await getApiClient();
  const res = await client.get<JobLogsResponse>(
    `/api/v1/jobs/${encodeURIComponent(jobId)}/logs`
  );
  return res.data;
}

/**
 * Fetch aggregate simulation counts for the listing hero. Same userId
 * scoping rules as fetchJobs (see above).
 */
export async function fetchJobStats(userId?: string): Promise<JobStatsResponse> {
  const client = await getApiClient();
  const params = userId ? { user_id: userId } : undefined;
  const res = await client.get<JobStatsResponse>("/api/v1/jobs/stats", { params });
  return res.data;
}
