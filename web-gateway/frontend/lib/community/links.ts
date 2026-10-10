/**
 * Address checks for what the Community pages link to and show. The backend
 * validates rich text on write, but the renderer re-checks every address it
 * is about to put in the page, so a document that got in some other way (an
 * old row, a direct database edit) still cannot carry a `javascript:` link.
 */

/** Control characters can smuggle a scheme past a prefix check ("java\tscript:"). */
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * The address when it is safe to link to: `http(s)://`, `mailto:`, or a path
 * on this site that starts with a single "/". Anything else (`javascript:`,
 * `data:`, "//host", "/\host", a bare word) is `null`.
 */
export function safeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const value = href.trim();
  if (!value || CONTROL.test(value)) return null;
  if (/^https?:\/\/[^\s/]/i.test(value) || /^mailto:[^\s]/i.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) return value;
  return null;
}

/** Whether a safe address leaves this site: it opens in a new tab. A `mailto:` link does not. */
export function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

/**
 * The address of an image when it is safe to load: `https://`, or a path on
 * this site (uploads are `/api/community/files/<id>`). Plain `http://` is
 * refused because the page is served over https.
 */
export function safeImageSrc(src: unknown): string | null {
  if (typeof src !== "string") return null;
  const value = src.trim();
  if (!value || CONTROL.test(value)) return null;
  if (/^https:\/\/[^\s/]/i.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) return value;
  return null;
}

/** The path every uploaded file is served at. */
export const COMMUNITY_FILE_PREFIX = "/api/community/files/";
