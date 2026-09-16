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
} from "@/lib/jobs/types";
import type { RepositoryListResponse } from "@/lib/repository/types";

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
 * Fetch a single job by ID.
 */
export async function fetchJob(jobId: string): Promise<Job | null> {
  try {
    const client = await getApiClient();
    const res = await client.get<Job>(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
    return res.data;
  } catch (error: unknown) {
    const axiosError = error as { response?: { status?: number } };
    if (axiosError?.response?.status === 404) return null;
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

/**
 * Fetch snapshot-type datasets for the New Simulation selection page.
 */
export async function fetchSnapshots(
  searchQuery: string = "",
  page: number = 1
): Promise<RepositoryListResponse> {
  const client = await getApiClient();
  const params: Record<string, string | number> = {
    type: "snapshot",
    page,
    page_size: 9,
    sort: "relevance",
  };
  if (searchQuery.trim()) params.q = searchQuery.trim();
  const res = await client.get<RepositoryListResponse>("/api/v1/repository/datasets", { params });
  return res.data;
}
