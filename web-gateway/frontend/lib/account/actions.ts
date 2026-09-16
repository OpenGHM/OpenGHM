"use server";

import { getApiClient } from "@/lib/api-client";
import type { UserProfile, SessionListResponse } from "@/lib/account/types";

export async function fetchMe(): Promise<UserProfile | null> {
  try {
    const client = await getApiClient();
    const res = await client.get<UserProfile>("/api/v1/users/me");
    return res.data;
  } catch {
    return null;
  }
}

export async function updateMe(
  updates: { name?: string; organization?: string | null }
): Promise<{ ok: boolean; message?: string; profile?: UserProfile }> {
  try {
    const client = await getApiClient();
    const res = await client.patch<UserProfile>("/api/v1/users/me", updates);
    return { ok: true, profile: res.data };
  } catch (err) {
    const detail =
      (err as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail ?? "Update failed.";
    return { ok: false, message: detail };
  }
}

/**
 * The backend reissues tokens for the calling session on success, but the
 * frontend doesn't consume them here — simpler and safer to have the user
 * sign in again with their new password than to splice fresh tokens into
 * an already-issued NextAuth session. Callers should signOut() after a
 * successful result.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ ok: boolean; message?: string }> {
  try {
    const client = await getApiClient();
    await client.post("/api/v1/auth/change-password", {
      current_password: currentPassword,
      new_password: newPassword,
    });
    return { ok: true };
  } catch (err) {
    const detail =
      (err as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail ?? "Failed to change password.";
    return { ok: false, message: detail };
  }
}

export async function fetchMySessions(): Promise<SessionListResponse> {
  const client = await getApiClient();
  const res = await client.get<SessionListResponse>("/api/v1/auth/sessions");
  return res.data;
}

export async function revokeMySession(sessionId: string): Promise<{ ok: boolean }> {
  try {
    const client = await getApiClient();
    await client.delete(`/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Revokes every session, including the one making this request — the
 * caller must sign the user out client-side afterwards (signOut(), not
 * router.refresh()), or their next request 401s against a dead token.
 */
export async function logoutAllSessions(): Promise<{ ok: boolean }> {
  try {
    const client = await getApiClient();
    await client.post("/api/v1/auth/logout-all");
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
