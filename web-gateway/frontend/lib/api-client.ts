import axios from "axios";
import { auth } from "@/lib/auth";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8100";

/**
 * Creates an Axios instance pre-configured to call FastAPI.
 * Must only be called from Server Components, Server Actions, or Route Handlers.
 * The browser never calls FastAPI directly (except the register endpoint).
 * `timeoutMs` raises the 10 s default for the one call that legitimately takes
 * longer (submitting a job opens an SSH session to Anvil).
 */
export async function getApiClient(options: { timeoutMs?: number } = {}) {
  const session = await auth();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

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

  return axios.create({
    baseURL: BACKEND_URL,
    headers,
    timeout: options.timeoutMs ?? 10_000,
    paramsSerializer: { indexes: null },
  });
}
