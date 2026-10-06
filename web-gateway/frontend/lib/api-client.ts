import axios from "axios";
import { auth } from "@/lib/auth";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8100";

/**
 * Creates an Axios instance pre-configured to call FastAPI.
 * Must only be called from Server Components, Server Actions, or Route Handlers.
 * The browser never calls FastAPI directly (except the register endpoint).
 * `timeoutMs` raises the 10 s default for the calls that legitimately take
 * longer (submitting, cancelling or deleting a job opens an SSH session to Anvil).
 *
 * With no usable session (signed out, or a token that could not be refreshed)
 * it throws a 401-shaped error instead of building a client: a call with no
 * credentials must never reach the backend, where in development an
 * unauthenticated request is the mock user (ALLOW_MOCK_AUTH) and in production
 * a 401 at best. `describeFailure` and `isUnauthorizedError` read the error as
 * the 401 it stands for, so a server action answers `session_expired` and a
 * page redirects to sign in. Only a caller of an endpoint that is open to
 * anonymous visitors (the Data Repository's reads) passes `allowAnonymous`.
 */
export async function getApiClient(
  options: { timeoutMs?: number; allowAnonymous?: boolean } = {}
) {
  const { headers, authenticated } = await getBackendAuth();
  if (!authenticated && !options.allowAnonymous) throw notSignedInError();

  return axios.create({
    baseURL: BACKEND_URL,
    headers: { "Content-Type": "application/json", ...headers },
    timeout: options.timeoutMs ?? 10_000,
    paramsSerializer: { indexes: null },
  });
}

/** What `getApiClient` throws without a session: shaped like the axios error of
 *  a 401, so every existing reader of a 401 treats it as one. */
function notSignedInError() {
  return Object.assign(new Error("Not signed in."), {
    response: { status: 401, data: { detail: "Not signed in." } },
  });
}

/** The backend's address, for the one caller that cannot use an Axios
 *  instance: a route handler streaming a response body through. */
export { BACKEND_URL };

/**
 * The credentials the backend is called with, for the signed-in user.
 * `authenticated` is false when there is nothing to send (no session, or one
 * whose token could not be refreshed), so a caller that must not reach the
 * backend anonymously can answer 401 itself. Same rules for every caller: this
 * is where they live.
 */
export async function getBackendAuth(): Promise<{
  headers: Record<string, string>;
  authenticated: boolean;
}> {
  const session = await auth();
  const headers: Record<string, string> = {};

  if (session?.error) {
    // The jwt callback in auth.ts already tried and failed to refresh the
    // backend access token — session.user.accessToken (if set at all) is
    // known-dead at this point. Sending it anyway just trades a clear
    // "not authenticated" for a confusing 401 deep in a page's data
    // fetching. Falling through with no Authorization header gets the same
    // 401 from the backend, but callers checking session.error can show a
    // "please sign in again" state instead.
  } else if (session?.user?.accessToken) {
    // Real JWT issued by the backend — used in both dev and prod
    headers["Authorization"] = `Bearer ${session.user.accessToken}`;
  } else if (process.env.NODE_ENV === "development" && session?.user?.role) {
    // Fallback: dev mock mode (no real login, just role header)
    headers["X-Mock-Role"] = session.user.role;
  }

  return { headers, authenticated: Object.keys(headers).length > 0 };
}
