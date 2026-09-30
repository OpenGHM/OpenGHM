"use server";

import { getApiClient } from "@/lib/api-client";
import type {
  ActionFailure,
  ActionResult,
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

type ApiClient = Awaited<ReturnType<typeof getApiClient>>;

function describeFailure(error: unknown, notFoundStatuses: number[]): ActionFailure {
  const response = (
    error as { response?: { status?: number; data?: { detail?: unknown } } }
  )?.response;
  const status = response?.status;
  if (status === 401) return { ok: false, reason: "session_expired" };
  if (status !== undefined && notFoundStatuses.includes(status)) {
    return { ok: false, reason: "not_found" };
  }
  // `detail` is a plain string on most routes, and `{ code, message }` on the
  // submit gates' 403 and 429 (mock_identity, email_not_verified,
  // not_permitted_to_run, active_job_limit, ...).
  const detail = response?.data?.detail;
  let message: string | null = null;
  let code: string | undefined;
  if (typeof detail === "string") {
    message = detail;
  } else if (detail && typeof detail === "object") {
    const d = detail as { code?: unknown; message?: unknown };
    if (typeof d.message === "string") message = d.message;
    if (typeof d.code === "string") code = d.code;
  }
  if (message === null) {
    message = error instanceof Error ? error.message : "Request failed.";
  }
  return { ok: false, reason: "error", message, status, code };
}

/**
 * Runs one backend call and folds its failures into an ActionResult, so a
 * 401 reaches the screen as data instead of a thrown error. `notFoundStatuses`
 * are the statuses that mean "this job is not there for you": 404 everywhere
 * (ADR 0024), plus 403 where a caller may still hold an old-contract answer.
 */
async function run<T>(
  call: (client: ApiClient) => Promise<T>,
  notFoundStatuses: number[] = [404]
): Promise<ActionResult<T>> {
  try {
    const client = await getApiClient();
    return { ok: true, data: await call(client) };
  } catch (error: unknown) {
    return describeFailure(error, notFoundStatuses);
  }
}

/**
 * Submit a new simulation job.
 */
export async function submitJob(
  request: JobSubmitRequest
): Promise<ActionResult<JobSubmitResponse>> {
  // 403 here means "not permitted to run" (ADR 0024), not "not found".
  return run(async (client) => {
    const res = await client.post<JobSubmitResponse>("/api/v1/jobs", request);
    return res.data;
  });
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
): Promise<ActionResult<Job>> {
  return run(async (client) => {
    const res = await client.post<Job>(
      `/api/v1/jobs/derive/${encodeURIComponent(datasetId)}`,
      request
    );
    return res.data;
  });
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
): Promise<ActionResult<Job>> {
  return run(async (client) => {
    const res = await client.patch<Job>(
      `/api/v1/jobs/${encodeURIComponent(jobId)}`,
      request
    );
    return res.data;
  });
}

/**
 * Fetch a single job by ID. Used by server components: `not_found` becomes the
 * page's notFound(), `session_expired` a redirect to sign in (see
 * redirectToSignIn in lib/auth-guard.ts).
 *
 * The backend answers 404 for a job that is missing or not yours (ADR 0024).
 * 403 is still treated as not-found so an old backend degrades the same way.
 */
export async function fetchJob(jobId: string): Promise<ActionResult<Job>> {
  return run(async (client) => {
    const res = await client.get<Job>(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
    return res.data;
  }, [404, 403]);
}

/**
 * Poll a job's latest status (lightweight endpoint).
 */
export async function pollJobStatus(
  jobId: string
): Promise<ActionResult<JobStatusResponse>> {
  return run(async (client) => {
    const res = await client.get<JobStatusResponse>(
      `/api/v1/jobs/${encodeURIComponent(jobId)}/status`
    );
    return res.data;
  });
}

/**
 * Cancel a running/pending job.
 */
export async function cancelJob(
  jobId: string
): Promise<ActionResult<JobStatusResponse>> {
  return run(async (client) => {
    const res = await client.post<JobStatusResponse>(
      `/api/v1/jobs/${encodeURIComponent(jobId)}/cancel`
    );
    return res.data;
  });
}

/**
 * Fetch stdout/stderr logs for a job.
 */
export async function fetchJobLogs(
  jobId: string
): Promise<ActionResult<JobLogsResponse>> {
  return run(async (client) => {
    const res = await client.get<JobLogsResponse>(
      `/api/v1/jobs/${encodeURIComponent(jobId)}/logs`
    );
    return res.data;
  });
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
