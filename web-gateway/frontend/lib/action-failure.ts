import type { ActionFailure, ActionFieldError } from "@/lib/jobs/types";

/** Shown when the call got no answer at all (connection refused, DNS, reset):
 *  the backend never saw it, so nothing changed. */
export const BACKEND_UNREACHABLE_MESSAGE =
  "The gateway's server could not be reached. Nothing was changed; try again in a minute.";
/** Shown when the call timed out: the backend may have done it. */
export const BACKEND_TIMEOUT_MESSAGE =
  "No answer yet; it may still have gone through. Reload the page to check.";
/** Shown for a 5xx that carried no message of its own. */
export const SERVER_ERROR_MESSAGE =
  "The gateway's server hit a problem and could not do this. Try again in a minute; if it keeps happening, tell an administrator.";

/** Whether an error thrown without a response is a timeout (axios: `ECONNABORTED`
 *  or `ETIMEDOUT`, message "timeout of Nms exceeded"). */
function isTimeout(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  return (
    e?.code === "ECONNABORTED" ||
    e?.code === "ETIMEDOUT" ||
    (typeof e?.message === "string" && /timeout|timed out/i.test(e.message))
  );
}

/** Folds what Axios threw into an `ActionFailure`, so a server action returns a
 *  refusal as data. Shared by the Workspace and Admin actions: the backend's
 *  error envelope (`detail`) is read in this one place. */
export function describeFailure(error: unknown, notFoundStatuses: number[]): ActionFailure {
  const response = (
    error as { response?: { status?: number; data?: { detail?: unknown } } }
  )?.response;
  const status = response?.status;
  if (status === 401) return { ok: false, reason: "session_expired" };
  if (status !== undefined && notFoundStatuses.includes(status)) {
    return { ok: false, reason: "not_found" };
  }
  // `detail` is a plain string on most routes, and `{ code, message }` on the
  // submit gates' 403 and 429 (mock_identity, email_not_verified,
  // not_permitted_to_run, active_job_limit, ...) and on the submit route's own
  // answers (not_a_draft, unsupported_fields with `fields`, anvil_unreachable,
  // sbatch_rejected, ...), and the PATCH's run_start_not_aligned with
  // `suggested_start`. A request body that fails validation is a 422 whose
  // `detail` is pydantic's array of `{ loc, msg, type }`.
  const detail = response?.data?.detail;

  // No response: the request never got an answer. Axios gives a refused
  // connection an EMPTY message (Node's AggregateError has none), so a
  // missing message and an empty one are the same thing here.
  if (response === undefined) {
    const own = error instanceof Error ? error.message.trim() : "";
    const isAxios = Boolean((error as { isAxiosError?: unknown } | null)?.isAxiosError);
    if (isTimeout(error)) return noAnswer("backend_timeout", BACKEND_TIMEOUT_MESSAGE);
    if (isAxios || own === "") return noAnswer("backend_unreachable", BACKEND_UNREACHABLE_MESSAGE);
    return noAnswer(undefined, own);
  }

  let message: string | null = null;
  let code: string | undefined;
  let fields: string[] | undefined;
  let suggestedStart: string | null | undefined;
  let conflictReason: string | undefined;
  let errors: ActionFieldError[] | undefined;
  let fieldErrors: Record<string, string> | undefined;
  if (typeof detail === "string") {
    message = detail;
  } else if (Array.isArray(detail)) {
    const items = detail.filter(
      (item): item is { loc?: unknown; msg?: unknown } => !!item && typeof item === "object"
    );
    const first = items.find((item) => typeof item.msg === "string");
    if (first) message = first.msg as string;
    const paths = items
      .map((item) => validationPath(item.loc))
      .filter((path): path is string => path !== null);
    if (paths.length > 0) fields = [...new Set(paths)];
  } else if (detail && typeof detail === "object") {
    const d = detail as {
      code?: unknown;
      message?: unknown;
      fields?: unknown;
      suggested_start?: unknown;
      reason?: unknown;
      errors?: unknown;
    };
    if (typeof d.message === "string") message = d.message;
    if (typeof d.code === "string") code = d.code;
    if (Array.isArray(d.fields) && d.fields.every((f) => typeof f === "string")) {
      fields = d.fields as string[];
    }
    if (typeof d.suggested_start === "string" || d.suggested_start === null) {
      suggestedStart = d.suggested_start;
    }
    // The publish route's 409 `not_publishable` names a `reason`, and its 422
    // `invalid_about` an `errors` list.
    if (typeof d.reason === "string") conflictReason = d.reason;
    if (Array.isArray(d.errors)) {
      const listed = d.errors.map(fieldError).filter((e): e is ActionFieldError => e !== null);
      if (listed.length > 0) errors = listed;
    } else if (d.errors && typeof d.errors === "object") {
      // `invalid_custom_params`: a map of init key path to message.
      const entries = Object.entries(d.errors as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== ""
      );
      if (entries.length > 0) fieldErrors = Object.fromEntries(entries);
    }
  }
  if (message === null || message.trim() === "") {
    // A 5xx with no sentence of its own is never shown as axios words
    // ("Request failed with status code 500").
    if (status !== undefined && status >= 500) {
      message = SERVER_ERROR_MESSAGE;
      code ??= "server_error";
    } else {
      message = "Request failed.";
    }
  }
  return { ok: false, reason: "error", message, status, code, fields, suggestedStart, conflictReason, errors, fieldErrors };
}

function noAnswer(code: string | undefined, message: string): ActionFailure {
  return { ok: false, reason: "error", message, status: undefined, code };
}

/** A pydantic error's `loc` as a dotted path without the leading "body":
 *  `["body", "slurm_config", "cores"]` is `slurm_config.cores`. Null when
 *  it names nothing. */
function validationPath(loc: unknown): string | null {
  if (!Array.isArray(loc)) return null;
  const parts = loc
    .filter((part): part is string | number => typeof part === "string" || typeof part === "number")
    .map(String);
  if (parts[0] === "body") parts.shift();
  return parts.length > 0 ? parts.join(".") : null;
}

/** One entry of an `errors` list as a field error. The backend may send a
 *  pydantic error (`{ loc, msg }`), `{ field | path, message }`, or a bare
 *  sentence; anything with no sentence in it is dropped. */
function fieldError(item: unknown): ActionFieldError | null {
  if (typeof item === "string") return item.trim() ? { path: null, message: item } : null;
  if (!item || typeof item !== "object") return null;
  const e = item as { loc?: unknown; msg?: unknown; message?: unknown; field?: unknown; path?: unknown };
  const message = typeof e.msg === "string" ? e.msg : typeof e.message === "string" ? e.message : "";
  if (!message.trim()) return null;
  const named = typeof e.field === "string" ? e.field : typeof e.path === "string" ? e.path : null;
  return { path: named ?? validationPath(e.loc), message };
}
