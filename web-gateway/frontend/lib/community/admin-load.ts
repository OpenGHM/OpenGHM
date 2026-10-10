import { redirectToSignIn } from "@/lib/auth-guard";
import type { ActionResult } from "@/lib/jobs/types";

/** What a page got from a read: the data, or a sentence for its inline error. */
export type Loaded<T> = { ok: true; data: T } | { ok: false; status?: number; message: string };

/**
 * An admin read as a page uses it. An ended session sends the visitor to sign
 * in and back to `here` (a page cannot render a banner for it); a refusal
 * becomes a sentence. A 403 is told apart, because it means the account is not
 * an admin rather than that the service is down.
 */
export function settle<T>(result: ActionResult<T>, here: string): Loaded<T> {
  if (result.ok) return result;
  if (result.reason === "session_expired") redirectToSignIn(here);
  if (result.reason === "not_found") return { ok: false, status: 404, message: "That item no longer exists." };
  if (result.status === 403) return { ok: false, status: 403, message: "Only admins can edit Community content." };
  return { ok: false, status: result.status, message: result.message };
}
