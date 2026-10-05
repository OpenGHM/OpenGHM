import type { ActionFailure } from "@/lib/jobs/types";

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
  let message: string | null = null;
  let code: string | undefined;
  let fields: string[] | undefined;
  let suggestedStart: string | null | undefined;
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
    };
    if (typeof d.message === "string") message = d.message;
    if (typeof d.code === "string") code = d.code;
    if (Array.isArray(d.fields) && d.fields.every((f) => typeof f === "string")) {
      fields = d.fields as string[];
    }
    if (typeof d.suggested_start === "string" || d.suggested_start === null) {
      suggestedStart = d.suggested_start;
    }
  }
  if (message === null) {
    message = error instanceof Error ? error.message : "Request failed.";
  }
  return { ok: false, reason: "error", message, status, code, fields, suggestedStart };
}

/** A pydantic error's `loc` as a dotted path without the leading "body":
 *  `["body", "slurm_config", "walltime"]` is `slurm_config.walltime`. Null when
 *  it names nothing. */
function validationPath(loc: unknown): string | null {
  if (!Array.isArray(loc)) return null;
  const parts = loc
    .filter((part): part is string | number => typeof part === "string" || typeof part === "number")
    .map(String);
  if (parts[0] === "body") parts.shift();
  return parts.length > 0 ? parts.join(".") : null;
}
