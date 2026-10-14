"use server";

import { cookies } from "next/headers";
import { getApiClient } from "@/lib/api-client";
import { auth } from "@/lib/auth";
import { SSO_CONNECT_COOKIE, SSO_CONNECT_MAX_AGE_SECONDS, connectCookieValue } from "@/lib/sso-connect";
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

/**
 * The first half of connecting CILogon from the profile: asks the backend for
 * a connect intent and leaves its token in an httpOnly cookie for the CILogon
 * callback to pick up (lib/auth.ts `signIn`). The caller then starts the
 * CILogon sign-in itself — a server action cannot, it has to navigate the
 * browser.
 *
 * `sameSite: "lax"` is what lets the cookie come back: CILogon redirects the
 * browser to the callback as a cross-site top-level navigation, which "strict"
 * would not send it on.
 */
export async function connectCilogon(): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const userId = (await auth())?.user?.id;
    if (!userId) return { ok: false, message: "Sign in again, then connect CILogon." };
    const client = await getApiClient();
    const res = await client.post<{ connect_token: string }>("/api/v1/auth/sso-connect-intent");
    const publicUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "";
    (await cookies()).set(SSO_CONNECT_COOKIE, connectCookieValue(userId, res.data.connect_token), {
      httpOnly: true,
      sameSite: "lax",
      secure: publicUrl.startsWith("https://"),
      path: "/",
      maxAge: SSO_CONNECT_MAX_AGE_SECONDS,
    });
    return { ok: true };
  } catch (err) {
    const detail =
      (err as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail ?? "Could not start connecting CILogon.";
    return { ok: false, message: detail };
  }
}

/** Disconnects the CILogon identity. The backend refuses it while the account
 *  has no password, since CILogon would then be its only way in. */
export async function disconnectCilogon(): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const client = await getApiClient();
    await client.delete("/api/v1/users/me/sso");
    return { ok: true };
  } catch (err) {
    const detail =
      (err as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail ?? "Could not disconnect CILogon.";
    return { ok: false, message: detail };
  }
}
