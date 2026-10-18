import { isUnauthorizedError, redirectToSignIn } from "@/lib/auth-guard";

/**
 * Runs a page's read. A 401 means the backend no longer accepts the session
 * (the layout saw one that looked fine), so the admin goes to sign in and
 * comes back here, instead of reading "Couldn't load …". Any other failure is
 * `null`, for the page to say so.
 */
export async function loadOrSignIn<T>(here: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    if (isUnauthorizedError(error)) redirectToSignIn(here);
    return null;
  }
}

/** The same for reads started together with `Promise.allSettled`. */
export function signInIfUnauthorized(here: string, results: PromiseSettledResult<unknown>[]): void {
  for (const r of results) {
    if (r.status === "rejected" && isUnauthorizedError(r.reason)) redirectToSignIn(here);
  }
}
