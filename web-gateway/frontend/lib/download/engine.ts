import { refusalMessage } from "@/lib/repository/output";
import { filenameFromDisposition } from "@/lib/workspace/log-download";

/**
 * One way to take down anything the gateway has to prepare before the first byte (a ZIP, a file
 * read from Anvil, a NetCDF cut from the output). The page shows the same dialog for all of
 * them (`DownloadProvider`); this is the part that does the work and reports where it is.
 *
 * Where the bytes go depends on what the browser can do and how big the download is:
 * - **disk**: a browser with `showSaveFilePicker` (Chrome, Edge) writes the response to the chosen
 *   file as it arrives, so any size, with progress, and nothing held in memory;
 * - **memory**: below `MEMORY_LIMIT_BYTES` (or when no native download is allowed) the response is
 *   read into a Blob and saved, with progress;
 * - **native**: a big download in a browser without the picker is handed to the browser itself
 *   (a hidden form in a hidden frame). The page cannot see its bytes, only when it starts: the
 *   gateway sets the cookie `ghm-dl` to the request's `dl` token with the response. A published
 *   object (`direct`) is handed over as a link to its URL instead.
 */

export const MEMORY_LIMIT_BYTES = 512 * 1024 * 1024;
export const COOKIE_NAME = "ghm-dl";

export interface DownloadJob {
  /** What the dialog calls it: "3 files", "wbm_2001.nc". */
  title: string;
  /** The name the file is saved as when the response does not name one. */
  filename: string;
  url: string;
  /** `POST` sends `fields` as a form body (what a ZIP of a selection is asked with). */
  method?: "GET" | "POST";
  fields?: [string, string][];
  /** The size to expect, if known (an upper bound is fine): chooses where the bytes go. */
  expectedBytes?: number | null;
  /** May a big download without the picker go to the browser itself? Needs the gateway to set the cookie. */
  native?: boolean;
  /**
   * `url` is a public object of the bucket, read with CORS (ADR 0043): a big download without the
   * picker is handed over as a plain link, with no cookie to say it started.
   */
  direct?: boolean;
  /** A line under the title, shown while preparing. */
  note?: string;
}

export type DownloadState =
  | { phase: "preparing" }
  | { phase: "downloading"; received: number; total: number | null; bytesPerSecond: number }
  | { phase: "handed-off" }
  | { phase: "done"; filename: string }
  | { phase: "failed"; message: string };

export type Where = "disk" | "memory" | "native";

interface Picker {
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
}

export function chooseWhere(
  job: Pick<DownloadJob, "expectedBytes" | "native" | "direct">,
  canPick: boolean
): Where {
  const big = (job.expectedBytes ?? 0) >= MEMORY_LIMIT_BYTES;
  if (big && canPick) return "disk";
  if (big && (job.native || job.direct)) return "native";
  return "memory";
}

/** What a refused request says, whatever it was answered with. */
export function failureMessage(status: number, body: unknown): string {
  if (status === 401) return "Your session has expired. Sign in again.";
  return refusalMessage(body) ?? "The download could not be prepared. Try again.";
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function isAbort(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === "AbortError";
}

function withToken(url: string, token: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}dl=${token}`;
}

function cookieHas(token: string): boolean {
  return document.cookie.split("; ").some((c) => c === `${COOKIE_NAME}=${token}`);
}

/** The refusal a hidden frame loaded instead of a download, if that is what it holds. */
function refusalIn(frame: HTMLIFrameElement): string | null {
  try {
    const text = frame.contentDocument?.body?.textContent;
    if (!text) return null;
    return failureMessage(0, JSON.parse(text));
  } catch {
    return null;
  }
}

function runNative(job: DownloadJob, signal: AbortSignal, report: (s: DownloadState) => void): Promise<void> {
  return new Promise((resolve) => {
    const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const frame = document.createElement("iframe");
    frame.name = `dl-${token}`;
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    const form = document.createElement("form");
    form.method = job.method === "POST" ? "POST" : "GET";
    form.action = withToken(job.url, token);
    form.target = frame.name;
    form.hidden = true;
    for (const [name, value] of job.fields ?? []) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.append(input);
    }
    const finish = (state: DownloadState | null) => {
      clearInterval(timer);
      signal.removeEventListener("abort", onAbort);
      frame.remove();
      form.remove();
      if (state) report(state);
      resolve();
    };
    const onAbort = () => finish(null);
    const timer = setInterval(() => {
      if (cookieHas(token)) finish({ phase: "handed-off" });
    }, 400);
    frame.addEventListener("load", () => {
      const message = refusalIn(frame);
      if (message) finish({ phase: "failed", message });
    });
    signal.addEventListener("abort", onAbort, { once: true });
    document.body.append(frame, form);
    form.submit();
  });
}

/**
 * Starts `job` and reports its state until it ends. Resolves when it is over (done, failed,
 * handed off or stopped); aborting `signal` stops it, and a stop reports nothing. Call it
 * from the click that asked for the download: the file picker needs that.
 */
export async function runDownload(
  job: DownloadJob,
  signal: AbortSignal,
  report: (state: DownloadState) => void
): Promise<void> {
  const picker = (window as unknown as Picker).showSaveFilePicker;
  const where = chooseWhere(job, typeof picker === "function");
  report({ phase: "preparing" });

  if (where === "native" && job.direct) {
    const link = document.createElement("a");
    link.href = job.url;
    link.download = job.filename;
    document.body.append(link);
    link.click();
    link.remove();
    report({ phase: "handed-off" });
    return;
  }
  if (where === "native") return runNative(job, signal, report);

  let writable: FileSystemWritableFileStream | null = null;
  try {
    if (where === "disk") {
      // First, still inside the click: the picker is refused after an await.
      const handle = await picker!.call(window, { suggestedName: job.filename });
      writable = await handle.createWritable();
    }
    const init: RequestInit = { signal, cache: "no-store" };
    if (job.method === "POST") {
      init.method = "POST";
      init.body = new URLSearchParams(job.fields ?? []);
    }
    const response = await fetch(job.url, init);
    if (!response.ok || !response.body) {
      const body: unknown = await response.json().catch(() => null);
      await writable?.abort().catch(() => {});
      report({ phase: "failed", message: failureMessage(response.status, body) });
      return;
    }
    const filename = filenameFromDisposition(response.headers.get("content-disposition"), job.filename);
    const total = Number(response.headers.get("content-length")) || null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    const started = Date.now();
    let received = 0;
    let lastReport = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (writable) await writable.write(value as unknown as BufferSource);
      else chunks.push(value);
      received += value.length;
      const now = Date.now();
      if (now - lastReport >= 150) {
        lastReport = now;
        report({
          phase: "downloading",
          received,
          total,
          bytesPerSecond: received / Math.max(0.001, (now - started) / 1000),
        });
      }
    }
    if (total !== null && received !== total) throw new Error("The download ended early.");
    if (writable) await writable.close();
    else saveBlob(new Blob(chunks as BlobPart[], { type: "application/octet-stream" }), filename);
    report({ phase: "done", filename: writable ? job.filename : filename });
  } catch (error) {
    await writable?.abort().catch(() => {});
    if (isAbort(error) || signal.aborted) return;
    report({ phase: "failed", message: "The download stopped before it finished. Try again." });
  }
}
