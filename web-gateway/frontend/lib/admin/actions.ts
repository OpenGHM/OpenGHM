"use server";

import { getApiClient } from "@/lib/api-client";
import { describeFailure } from "@/lib/action-failure";
import type { UserRole } from "@/lib/auth.types";
import type { ActionResult, JobStatsResponse } from "@/lib/jobs/types";
import type { SessionListResponse } from "@/lib/account/types";
import type {
  AuditFilters,
  AuditLogListResponse,
  AdminUser,
  AdminUserDetail,
  UserListResponse,
  TimeSeriesResponse,
  StatusBreakdownResponse,
  SystemInfoResponse,
  AnvilScratchResponse,
  SpoolClearResponse,
  UserLabel,
  UserLabels,
} from "@/lib/admin/types";

/**
 * All of these hit endpoints gated server-side by Permission.USER_VIEW_ANY /
 * USER_MANAGE (see web-gateway/backend/app/api/v1/users.py, admin.py). A non-admin/staff
 * caller gets a 403 from the backend — these functions don't duplicate that
 * check, they rely on it.
 */

export async function fetchUsers(
  page: number = 1,
  role?: UserRole,
  filters?: { q?: string; is_active?: boolean }
): Promise<UserListResponse> {
  const client = await getApiClient();
  const res = await client.get<UserListResponse>("/api/v1/users", {
    params: {
      page,
      page_size: 20,
      ...(role ? { role } : {}),
      ...(filters?.q ? { q: filters.q } : {}),
      ...(filters?.is_active !== undefined ? { is_active: filters.is_active } : {}),
    },
  });
  return res.data;
}

export async function fetchUserDetail(userId: string): Promise<AdminUserDetail | null> {
  try {
    const client = await getApiClient();
    const res = await client.get<AdminUserDetail>(`/api/v1/users/${encodeURIComponent(userId)}`);
    return res.data;
  } catch (error: unknown) {
    const axiosError = error as { response?: { status?: number } };
    if (axiosError?.response?.status === 404) return null;
    throw error;
  }
}

export async function fetchUserSessions(userId: string): Promise<SessionListResponse> {
  const client = await getApiClient();
  const res = await client.get<SessionListResponse>(
    `/api/v1/users/${encodeURIComponent(userId)}/sessions`
  );
  return res.data;
}

export async function revokeUserSession(
  userId: string,
  sessionId: string
): Promise<{ ok: boolean }> {
  try {
    const client = await getApiClient();
    await client.delete(
      `/api/v1/users/${encodeURIComponent(userId)}/sessions/${encodeURIComponent(sessionId)}`
    );
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function revokeAllUserSessions(userId: string): Promise<{ ok: boolean; revoked?: number }> {
  try {
    const client = await getApiClient();
    const res = await client.delete<{ revoked: number }>(
      `/api/v1/users/${encodeURIComponent(userId)}/sessions`
    );
    return { ok: true, revoked: res.data.revoked };
  } catch {
    return { ok: false };
  }
}

export async function updateUser(
  userId: string,
  updates: { role?: UserRole; is_active?: boolean; can_run_simulations?: boolean; email_verified?: true }
): Promise<{ ok: boolean; message?: string; user?: AdminUser }> {
  try {
    const client = await getApiClient();
    const res = await client.patch<AdminUser>(`/api/v1/users/${userId}`, updates);
    return { ok: true, user: res.data };
  } catch (err) {
    const detail = (err as { response?: { data?: { detail?: unknown } } })?.response
      ?.data?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : detail && typeof (detail as { message?: unknown }).message === "string"
          ? (detail as { message: string }).message
          : "Update failed.";
    return { ok: false, message };
  }
}

export async function fetchAuditLog(
  page: number = 1,
  filters: AuditFilters = {},
  pageSize: number = 50
): Promise<AuditLogListResponse> {
  const client = await getApiClient();
  const res = await client.get<AuditLogListResponse>("/api/v1/admin/audit-log", {
    params: {
      page,
      page_size: pageSize,
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.actor_id ? { actor_id: filters.actor_id } : {}),
      ...(filters.date_from ? { date_from: filters.date_from } : {}),
      ...(filters.date_to ? { date_to: filters.date_to } : {}),
    },
  });
  return res.data;
}

/**
 * Name and email for the users among `ids`, in one call (the job list's
 * owners, the audit log's actors and targets), keyed by id. An id that is no
 * user (a job id, `system`) is absent. A failure gives an empty map: the table
 * then shows the ids it was given, which is true if less friendly, and the
 * list itself has already told the page about an expired session.
 */
export async function fetchUserLabels(ids: string[]): Promise<UserLabels> {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 100);
  if (unique.length === 0) return {};
  try {
    const client = await getApiClient();
    const res = await client.get<{ items: UserLabel[] }>("/api/v1/admin/user-labels", {
      params: { ids: unique },
    });
    return Object.fromEntries(res.data.items.map((u) => [u.id, u]));
  } catch {
    return {};
  }
}

/** Site-wide job stats — user_id="*" requires Permission.JOB_VIEW_ANY
 * (staff/admin), see web-gateway/backend/app/api/v1/jobs.py's _job_scope_query. */
export async function fetchSiteJobStats(): Promise<JobStatsResponse> {
  const client = await getApiClient();
  const res = await client.get<JobStatsResponse>("/api/v1/jobs/stats", {
    params: { user_id: "*" },
  });
  return res.data;
}

export async function fetchTimeSeries(
  metric: "jobs" | "registrations",
  days: number = 30
): Promise<TimeSeriesResponse> {
  const client = await getApiClient();
  const res = await client.get<TimeSeriesResponse>(`/api/v1/admin/metrics/${metric}`, {
    params: { days },
  });
  return res.data;
}

export async function fetchJobStatusBreakdown(days?: number): Promise<StatusBreakdownResponse> {
  const client = await getApiClient();
  const res = await client.get<StatusBreakdownResponse>("/api/v1/admin/metrics/job-status", {
    params: days ? { days } : undefined,
  });
  return res.data;
}

export async function fetchSystemInfo(): Promise<SystemInfoResponse | null> {
  try {
    const client = await getApiClient();
    const res = await client.get<SystemInfoResponse>("/api/v1/admin/system");
    return res.data;
  } catch {
    return null;
  }
}

/** Both Anvil calls open an SSH session and walk the spool cache, which the
 *  10 s default does not allow for. */
const ANVIL_TIMEOUT_MS = 60_000;

/**
 * Scratch quota and the spool cache, read live from Anvil. A failure comes back
 * as data: 503 `anvil_not_configured` / `anvil_unreachable`, 502
 * `spool_status_failed` (`code`, `message`), 403 for a non-admin (`status`).
 */
export async function fetchAnvilScratch(): Promise<ActionResult<AnvilScratchResponse>> {
  try {
    const client = await getApiClient({ timeoutMs: ANVIL_TIMEOUT_MS });
    const res = await client.get<AnvilScratchResponse>("/api/v1/admin/anvil/scratch");
    return { ok: true, data: res.data };
  } catch (error: unknown) {
    return describeFailure(error, []);
  }
}

/**
 * Clears the spool cache on Anvil, except the years a running job holds. With
 * `dryRun` it only reports what it would delete. Failures as for
 * `fetchAnvilScratch`, plus 502 `spool_clear_failed`.
 */
export async function clearSpoolCache(dryRun: boolean): Promise<ActionResult<SpoolClearResponse>> {
  try {
    const client = await getApiClient({ timeoutMs: ANVIL_TIMEOUT_MS });
    const res = await client.post<SpoolClearResponse>("/api/v1/admin/anvil/spool-cache/clear", {
      dry_run: dryRun,
    });
    return { ok: true, data: res.data };
  } catch (error: unknown) {
    return describeFailure(error, []);
  }
}
