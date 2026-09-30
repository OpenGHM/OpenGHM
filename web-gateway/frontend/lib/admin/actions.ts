"use server";

import { getApiClient } from "@/lib/api-client";
import type { UserRole } from "@/lib/auth.types";
import type { JobStatsResponse } from "@/lib/jobs/types";
import type { SessionListResponse } from "@/lib/account/types";
import type {
  AuditCategory,
  AuditLogListResponse,
  AdminUser,
  AdminUserDetail,
  UserListResponse,
  TimeSeriesResponse,
  StatusBreakdownResponse,
  SystemInfoResponse,
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
  updates: { role?: UserRole; is_active?: boolean; can_run_simulations?: boolean }
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
  category?: AuditCategory
): Promise<AuditLogListResponse> {
  const client = await getApiClient();
  const res = await client.get<AuditLogListResponse>("/api/v1/admin/audit-log", {
    params: { page, page_size: 50, ...(category ? { category } : {}) },
  });
  return res.data;
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
