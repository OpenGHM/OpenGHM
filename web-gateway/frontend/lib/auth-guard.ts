import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { signInPath } from "@/lib/auth-redirect";

/** Sends the visitor to sign in, and back to `pathWithQuery` afterwards. */
export function redirectToSignIn(pathWithQuery: string): never {
  redirect(signInPath(pathWithQuery));
}

/**
 * Server-side page guard. A missing session and a session whose token refresh
 * failed (`session.error`, set in lib/auth.ts) are both "signed out": the
 * cookie is still alive but the backend would answer 401 to everything.
 *
 * `pathWithQuery` is the page's own URL, so sign-in returns the visitor to the
 * same place, query string included. Build it with `pathWithQuery()` from
 * lib/auth-redirect.ts and the page's `searchParams`.
 */
export async function requireSession(pathWithQuery: string): Promise<Session> {
  const session = await auth();
  if (!session || session.error) redirectToSignIn(pathWithQuery);
  return session;
}

/** True for an Axios error whose response was a 401. */
export function isUnauthorizedError(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 401;
}
