/**
 * Uploads one file to the Community media library through the gateway's own
 * route (`app/api/admin/community/files/route.ts`), never to the backend
 * directly. It uses XMLHttpRequest because `fetch` cannot report how much of a
 * request body has gone. The file is checked first (type and size), so a
 * refused file costs no round trip.
 */
import { checkUpload, formatFileSize, MAX_UPLOAD_BYTES, type UploadKind } from "@/lib/community/admin-format";
import type { CommunityFile } from "@/lib/community/types";

export const UPLOAD_URL = "/api/admin/community/files";

export type UploadResult =
  | { ok: true; file: CommunityFile }
  | { ok: false; reason: "session_expired" }
  | { ok: false; reason: "error"; message: string; status?: number };

/** The sentence an upload refusal carries, from the route's or the backend's body. */
export function uploadErrorMessage(status: number, body: unknown): string {
  const detail = (body as { detail?: unknown; message?: unknown } | null)?.detail ?? body;
  let message = "";
  if (typeof detail === "string") message = detail;
  else if (detail && typeof detail === "object" && typeof (detail as { message?: unknown }).message === "string") {
    message = (detail as { message: string }).message;
  }
  if (status === 413) return `That file is over the ${formatFileSize(MAX_UPLOAD_BYTES)} limit. Host it elsewhere and link to it instead.`;
  if (status === 415) return message || "That type of file can't be uploaded.";
  if (status === 403) return "Only admins can upload files.";
  if (status === 0) return "The upload could not reach the gateway. Check your connection and try again.";
  if (status >= 500) return message || "The gateway hit a problem and could not store the file. Try again in a minute.";
  return message || "The file could not be uploaded.";
}

export function uploadCommunityFile(
  file: File,
  options: { kind: UploadKind; onProgress?: (fraction: number) => void; signal?: AbortSignal }
): Promise<UploadResult> {
  const problem = checkUpload(file, options.kind);
  if (problem) return Promise.resolve({ ok: false, reason: "error", message: problem });

  return new Promise<UploadResult>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", UPLOAD_URL);
    xhr.responseType = "text";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) options.onProgress?.(event.loaded / event.total);
    };
    xhr.onerror = () => resolve({ ok: false, reason: "error", message: uploadErrorMessage(0, null), status: 0 });
    xhr.onabort = () => resolve({ ok: false, reason: "error", message: "The upload was cancelled." });
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      if (xhr.status === 401) return resolve({ ok: false, reason: "session_expired" });
      if (xhr.status >= 200 && xhr.status < 300 && body && typeof (body as CommunityFile).url === "string") {
        return resolve({ ok: true, file: body as CommunityFile });
      }
      resolve({ ok: false, reason: "error", message: uploadErrorMessage(xhr.status, body), status: xhr.status });
    };
    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });

    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}
