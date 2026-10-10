/**
 * What a refused Community admin request says, in terms a form can use: one
 * sentence for the whole form, and a sentence beside each field the backend
 * names. `describeFailure` reads the backend's envelope; this adds the parts a
 * form needs that it leaves out: the message of each field of a 422, and a 409
 * `slug_taken` as an error on the slug.
 */
import { describeFailure } from "@/lib/action-failure";
import type { ActionFailure, ActionFieldError } from "@/lib/jobs/types";

/** A pydantic error's `loc` as a dotted path without the leading "body". */
function pathOf(loc: unknown): string | null {
  if (!Array.isArray(loc)) return null;
  const parts = loc
    .filter((part): part is string | number => typeof part === "string" || typeof part === "number")
    .map(String);
  if (parts[0] === "body") parts.shift();
  return parts.length > 0 ? parts.join(".") : null;
}

/** The failure of an Axios error, with every field's own message when the
 *  backend sent a pydantic list. */
export function adminFailure(error: unknown): ActionFailure {
  const failure = describeFailure(error, [404]);
  if (failure.reason !== "error") return failure;

  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (Array.isArray(detail) && !failure.errors) {
    const errors: ActionFieldError[] = [];
    for (const item of detail) {
      if (!item || typeof item !== "object") continue;
      const { loc, msg } = item as { loc?: unknown; msg?: unknown };
      if (typeof msg === "string" && msg.trim()) errors.push({ path: pathOf(loc), message: msg });
    }
    if (errors.length > 0) return { ...failure, errors };
  }
  if (failure.status === 409 && failure.code === "slug_taken") {
    return { ...failure, errors: [{ path: "slug", message: failure.message }] };
  }
  return failure;
}

export interface FieldErrors {
  /** By dotted path (`title`, `details.0.label`). */
  fields: Record<string, string>;
  /** What belongs to no field. */
  general: string[];
}

/** A refusal split into the messages beside fields and the rest. A refusal
 *  that names fields but no messages (`fields` only) keeps its one sentence as
 *  the general one. */
export function splitFieldErrors(failure: Extract<ActionFailure, { reason: "error" }>): FieldErrors {
  const fields: Record<string, string> = {};
  const general: string[] = [];
  for (const error of failure.errors ?? []) {
    if (!error.path) general.push(error.message);
    else fields[error.path] = fields[error.path] ? `${fields[error.path]} ${error.message}` : error.message;
  }
  if (Object.keys(fields).length === 0 && general.length === 0) general.push(failure.message);
  return { fields, general };
}
