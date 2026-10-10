import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { signInPath } from "@/lib/auth-redirect";

/** Sends the visitor to sign in, and back to `pathWithQuery` afterwards. */
export function redirectToSignIn(pathWithQuery: string): never {
  redirect(signInPath(pathWithQuery));
}

/**
 * Server-side page guard that redirects. (The Workspace pages use
 * `workspaceSession` instead and show a sign-in page.) A missing session and a session whose token refresh
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

/** Why a Workspace visitor is signed out: no session at all, or one whose refresh failed. */
export type SignedOutReason = "none" | "expired";

/** What `workspaceSession()` found: the session, or the reason there is none. */
export type WorkspaceAccess = { session: Session } | { signedOut: SignedOutReason };

/**
 * The Workspace's page guard. Unlike `requireSession` it does not redirect: a
 * signed-out visitor stays on the page and is shown `SignInRequired`
 * (components/workspace/sign-in-required.tsx), which links to sign-in and back.
 *
 * - no session: `{ signedOut: "none" }`;
 * - a session whose token refresh failed (`session.error`, set in lib/auth.ts):
 *   `{ signedOut: "expired" }`. The cookie is alive but the backend would
 *   answer 401 to everything;
 * - otherwise `{ session }`.
 *
 * A page uses it as the first thing it does:
 *
 * ```tsx
 * const access = await workspaceSession();
 * if ("signedOut" in access) return <SignInRequired reason={access.signedOut} here={here} />;
 * ```
 */
export async function workspaceSession(): Promise<WorkspaceAccess> {
  const session = await auth();
  if (!session) return { signedOut: "none" };
  if (session.error) return { signedOut: "expired" };
  return { session };
}

/** True for an Axios error whose response was a 401. */
export function isUnauthorizedError(error: unknown): boolean {
  return (error as { response?: { status?: number } })?.response?.status === 401;
}
