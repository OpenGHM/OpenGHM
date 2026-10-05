"use server";

import { getApiClient } from "@/lib/api-client";
import { describeFailure } from "@/lib/action-failure";
import type {
  ActionResult,
  Job,
  JobListResponse,
  JobLogChunk,
  JobParameters,
  JobStatsResponse,
  JobStatusResponse,
  LogStream,
  PublishedAnswer,
  DraftDeriveRequest,
  DraftUpdateRequest,
} from "@/lib/jobs/types";

type ApiClient = Awaited<ReturnType<typeof getApiClient>>;

const SUBMIT_TIMEOUT_MS = 60_000;
/** The first answer for a snapshot lists its published files in the public
 *  bucket, which the 10 s default may not allow for. */
const PUBLISHED_ANSWER_TIMEOUT_MS = 20_000;

/**
 * Runs one backend call and folds its failures into an ActionResult, so a
 * 401 reaches the screen as data instead of a thrown error. `notFoundStatuses`
 * are the statuses that mean "this job is not there for you": 404 everywhere
 * (ADR 0024), plus 403 where a caller may still hold an old-contract answer.
 */
async function run<T>(
  call: (client: ApiClient) => Promise<T>,
  notFoundStatuses: number[] = [404],
  timeoutMs?: number
): Promise<ActionResult<T>> {
  try {
    const client = await getApiClient({ timeoutMs });
    return { ok: true, data: await call(client) };
  } catch (error: unknown) {
    return describeFailure(error, notFoundStatuses);
  }
}

/**
 * Submit a DRAFT to Anvil (ADR 0025). Owner only, and only for a user an
 * administrator has allowed to submit runs (ADR 0024). Nothing runs until
 * this succeeds; if Anvil does not take it the draft stays a draft and the
 * failure comes back as `{ reason: "error", code, message }`.
 *
 * A draft the snapshot's published output already answers is refused with
 * `code: "answered_by_published"` (409) unless `opts.rerun` is true: the person
 * asked, on purpose, to compute it again. The body is sent only for a rerun.
 *
 * Its own 60 s timeout: the backend opens an SSH session to Anvil and uploads
 * the script before it answers, which the 10 s default does not allow for.
 */
export async function submitDraft(
  jobId: string,
  opts?: { rerun?: boolean }
): Promise<ActionResult<Job>> {
  // 403 here means "not permitted to run" (ADR 0024), not "not found".
  return run(
    async (client) => {
      const url = `/api/v1/jobs/${encodeURIComponent(jobId)}/submit`;
      const res = opts?.rerun
        ? await client.post<Job>(url, { rerun: true })
        : await client.post<Job>(url);
      return res.data;
    },
    [404],
    SUBMIT_TIMEOUT_MS
  );
}

/**
 * Whether the snapshot's published output already answers a draft with these
 * parameters, and the public files that do. It takes the parameters rather than
 * a job id so that a new snapshot draft, which is not stored yet, can ask too.
 * Any signed-in user may ask (the files are public). Failures: `not_found` is
 * an unknown snapshot; a 502 `published_listing_unavailable` comes back as
 * `{ reason: "error", code, status }`, and callers treat every failure as "could
 * not be checked", never as a reason to stop a submit.
 */
export async function publishedAnswer(
  datasetId: string,
  parameters: JobParameters,
  modelInputId: string | null
): Promise<ActionResult<PublishedAnswer>> {
  return run(
    async (client) => {
      const res = await client.post<PublishedAnswer>(
        `/api/v1/repository/datasets/${encodeURIComponent(datasetId)}/published-answer`,
        { parameters, model_input_id: modelInputId }
      );
      return res.data;
    },
    [404],
    PUBLISHED_ANSWER_TIMEOUT_MS
  );
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
  // `sort=updated` is the backend's default; stated so the list does not
  // depend on it.
  const params: Record<string, string | number> = { page, page_size: 10, sort: "updated" };
  if (status) params.status = status;
  if (userId) params.user_id = userId;
  const res = await client.get<JobListResponse>("/api/v1/jobs", { params });
  return res.data;
}

/**
 * Create a new snapshot draft (status DRAFT) pre-filled from a published snapshot
 * (T4/T9) — the only creation path for a snapshot draft. The source dataset is
 * only ever read.
 */
export async function deriveDraft(
  datasetId: string,
  request: DraftDeriveRequest = {}
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
 * The draft `deriveDraft` would create from a snapshot, without creating
 * it: nothing is stored. The new snapshot draft wizard (`/workspace/new/<id>`) is
 * seeded with it and keeps everything in the browser until the user saves.
 * Its `id` carries no meaning (the backend sends an empty string): never use
 * it as a job id. `not_found` means the snapshot is not in the repository.
 */
export async function previewDraft(datasetId: string): Promise<ActionResult<Job>> {
  return run(async (client) => {
    const res = await client.get<Job>(
      `/api/v1/jobs/derive/${encodeURIComponent(datasetId)}`
    );
    return res.data;
  });
}

/**
 * Create a new DRAFT from one of the caller's own snapshot drafts, whatever its
 * status: the second creation path. The source is only ever read. A source
 * whose model snapshot has left the repository answers
 * `{ reason: "error", code: "snapshot_not_found" }` and nothing is created;
 * `not_found` means the source is missing or not the caller's.
 */
export async function duplicateDraft(jobId: string): Promise<ActionResult<Job>> {
  return run(async (client) => {
    const res = await client.post<Job>(
      `/api/v1/jobs/${encodeURIComponent(jobId)}/duplicate`
    );
    return res.data;
  });
}

/**
 * Edit a snapshot draft while it is still a DRAFT. The backend returns 409
 * once the status has moved past DRAFT — callers should check
 * `job.status` before offering the control rather than relying on this
 * throwing.
 */
export async function updateDraft(
  jobId: string,
  request: DraftUpdateRequest
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
 * Cancel a job that has not ended (ADR 0026). With a SLURM id the status does
 * not change yet: `cancel_requested_at` is set and the job is *Cancelling*
 * until SLURM confirms. Without one it comes back CANCELLED at once. Failures
 * carry the backend's `code`: `cancel_failed` (502), or a 409 when the job can
 * no longer be cancelled.
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
 * Delete a snapshot draft: a draft, or one that has ended. Removes the job's two
 * directories on Anvil and then the record (ADR 0026). On any failure the
 * snapshot draft still exists, and `code` says why: `job_active` (409, cancel it
 * first), `refused_path` (409), `anvil_unreachable` (503) or `cleanup_failed`
 * (502). `not_found` means it is already gone.
 */
export async function deleteDraft(jobId: string): Promise<ActionResult<null>> {
  return run(async (client) => {
    await client.delete(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
    return null;
  });
}

/**
 * Read one log of a job by byte offset (ADR 0027). Without `offset` the read
 * is the tail: it starts `limit` bytes before the end, at a line start. With
 * one it continues from there, and `next_offset` of the answer is the next
 * `offset`. A missing file is `exists: false`, not a failure.
 */
export async function fetchJobLog(
  jobId: string,
  stream: LogStream,
  offset?: number,
  limit?: number
): Promise<ActionResult<JobLogChunk>> {
  const params: Record<string, string | number> = { stream };
  if (offset !== undefined) params.offset = offset;
  if (limit !== undefined) params.limit = limit;
  return run(async (client) => {
    const res = await client.get<JobLogChunk>(
      `/api/v1/jobs/${encodeURIComponent(jobId)}/logs`,
      { params }
    );
    return res.data;
  });
}

/**
 * Fetch aggregate snapshot draft counts for the listing hero. Same userId
 * scoping rules as fetchJobs (see above).
 */
export async function fetchJobStats(userId?: string): Promise<JobStatsResponse> {
  const client = await getApiClient();
  const params = userId ? { user_id: userId } : undefined;
  const res = await client.get<JobStatsResponse>("/api/v1/jobs/stats", { params });
  return res.data;
}
