/**
 * A published object the browser can save by itself (ADR 0043). The bucket's `Content-Type`,
 * read with a `HEAD` (the bucket allows this site by CORS), says what a browser does with the URL:
 * one it would show (text, JSON, an image, a PDF) must be read by the page and saved, anything
 * else (`binary/octet-stream`, NetCDF in practice) the browser downloads itself, with its own
 * progress and no byte held by the page. The type is read, not guessed from the name, because the
 * bucket's types do not follow the names (`SHA256SUMS` comes as `application/json`, a `.txt` as
 * `binary/octet-stream`).
 */

const SHOWN_APPLICATION = new Set([
  "application/json",
  "application/xml",
  "application/pdf",
  "application/javascript",
  "application/ecmascript",
  "application/xhtml+xml",
]);

/** Whether a browser shows a response of `contentType` rather than saving it. */
export function showsInline(contentType: string | null): boolean {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (!type) return true; // unknown: a browser may sniff and show it
  if (/^(text|image|video|audio)\//.test(type)) return true;
  if (type.endsWith("+json") || type.endsWith("+xml")) return true;
  return SHOWN_APPLICATION.has(type);
}

/** What the bucket says the object is, or null when the `HEAD` fails. */
export async function headContentType(url: string): Promise<string | null | undefined> {
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    return response.ok ? response.headers.get("content-type") : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Hands `url` to the browser as a download: a hidden frame loads it, so neither the page nor a new
 * tab is replaced. Only for a URL the browser saves (`showsInline` false).
 */
export function saveInBrowser(url: string): void {
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.setAttribute("aria-hidden", "true");
  frame.src = url;
  document.body.append(frame);
  // Long enough for the download to have started; the download goes on after the frame is gone.
  setTimeout(() => frame.remove(), 60_000);
}
