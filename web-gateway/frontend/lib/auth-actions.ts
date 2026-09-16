"use server";

import { getApiClient } from "@/lib/api-client";

/**
 * Revokes the current user's refresh token on the backend (see
 * POST /auth/logout). Best-effort: if this fails (session already dead,
 * backend unreachable) we still want the client's signOut() to proceed and
 * clear the NextAuth session — a failed revoke just means the refresh
 * token dies on its own at its normal expiry instead of immediately.
 */
export async function revokeSession(): Promise<void> {
  try {
    const client = await getApiClient();
    await client.post("/api/v1/auth/logout");
  } catch {
    // best-effort — see comment above
  }
}

/**
 * Re-sends the email verification link. Returns a message to show the
 * user rather than throwing — the backend rate-limits this (see
 * POST /auth/resend-verification, 429 with a wait time) and that's a normal
 * outcome the UI should display, not an error state.
 */
export async function resendVerificationEmail(): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const client = await getApiClient();
    const res = await client.post<{ detail: string }>(
      "/api/v1/auth/resend-verification"
    );
    return { ok: true, message: res.data.detail };
  } catch (err) {
    const detail =
      (err as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail ?? "Could not resend verification email. Please try again.";
    return { ok: false, message: detail };
  }
}
