/**
 * Reading the answer of the download route (`/api/jobs/[id]/logs/[stream]`):
 * the file name the server chose, and the words of a refusal. The backend's
 * errors arrive as `{ detail: { code, message } }`, `{ detail: "text" }`, or
 * the route's own `{ code, message }`.
 */

/** The download route's address for one log. `job` is the job of a simulation
 *  run by several (ADR 0037) whose stdout or stderr is wanted; WBM's log is one
 *  file across jobs and is asked for without one. */
export function logDownloadUrl(jobId: string, stream: "stdout" | "stderr" | "wbm", job?: number): string {
  const base = `/api/jobs/${encodeURIComponent(jobId)}/logs/${stream}`;
  return job !== undefined && stream !== "wbm" ? `${base}?job=${job}` : base;
}

/** `filename` from a `Content-Disposition` header, or `fallback`. */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      // fall through to the plain form
    }
  }
  const quoted = /filename\s*=\s*"([^"]+)"/i.exec(header);
  if (quoted) return quoted[1];
  const bare = /filename\s*=\s*([^;]+)/i.exec(header);
  return bare ? bare[1].trim() : fallback;
}

/** The message of an error body, or `fallback` when it has none. */
export function messageFromErrorBody(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as { message?: unknown; detail?: unknown };
    if (typeof b.message === "string" && b.message) return b.message;
    if (typeof b.detail === "string" && b.detail) return b.detail;
    if (b.detail && typeof b.detail === "object") {
      const d = b.detail as { message?: unknown };
      if (typeof d.message === "string" && d.message) return d.message;
    }
  }
  return fallback;
}
