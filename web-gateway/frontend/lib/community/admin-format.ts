/**
 * The small pure helpers of the Community admin: slugs, file sizes and the
 * limits of an upload, the citation a publication shows, and moving a row in a
 * list. The forms and the media library share them.
 */
import type { TutorialKind } from "@/lib/community/types";

/** The most the backend stores for one upload. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** What an upload may be, by extension (the backend checks again). No SVG: it can carry script. */
export const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"] as const;
export const FILE_EXTENSIONS = [
  "pdf", "ppt", "pptx", "key", "doc", "docx", "xls", "xlsx", "csv", "zip", "gz", "tar",
  "ipynb", "mp4", "mov", "webm", "txt", "md",
] as const;

export type UploadKind = "image" | "file";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_SLUG_LENGTH = 80;

/** A title as a slug: lower case, accents removed, anything else a hyphen. */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug;
}

export function isValidSlug(slug: string): boolean {
  return slug.length <= MAX_SLUG_LENGTH && SLUG.test(slug);
}

/** `6.1 MB`, `340 KB`, `812 B`. Binary units, written the way people write them. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const tenths = (value: number) => value.toFixed(1).replace(/\.0$/, "");
  if (bytes < 1024 * 1024 * 1024) return `${tenths(bytes / (1024 * 1024))} MB`;
  return `${tenths(bytes / (1024 * 1024 * 1024))} GB`;
}

/** The lower-case extension of a file name, without the dot; "" when it has none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
}

/** A material's note for an uploaded file, as the template writes it: `PDF · 6.1 MB`. */
export function uploadNote(filename: string, size: number): string {
  const ext = fileExtension(filename).toUpperCase();
  const sized = formatFileSize(size);
  return [ext, sized].filter(Boolean).join(" · ");
}

/** The `accept` attribute of a file input for `kind`. */
export function acceptFor(kind: UploadKind): string {
  const list: readonly string[] = kind === "image" ? IMAGE_EXTENSIONS : [...IMAGE_EXTENSIONS, ...FILE_EXTENSIONS];
  return list.map((ext) => `.${ext}`).join(",");
}

/** Why a file cannot be uploaded, in a sentence; null when it can. Checked
 *  before the file leaves the browser, so a 30 MB video fails at once. */
export function checkUpload(file: { name: string; size: number }, kind: UploadKind): string | null {
  const ext = fileExtension(file.name);
  const allowed: readonly string[] = kind === "image" ? IMAGE_EXTENSIONS : [...IMAGE_EXTENSIONS, ...FILE_EXTENSIONS];
  if (!ext || !allowed.includes(ext)) {
    return kind === "image"
      ? "That is not an image the site can show. Use a JPG, PNG, WebP or GIF."
      : `A .${ext || "?"} file can't be uploaded. Allowed: ${allowed.join(", ")}.`;
  }
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is ${formatFileSize(file.size)}; the limit is ${formatFileSize(MAX_UPLOAD_BYTES)}. Host it elsewhere and link to it instead.`;
  }
  return null;
}

/** Whether a stored file is an image, by its content type. */
export function isImageType(contentType: string): boolean {
  return contentType.toLowerCase().startsWith("image/");
}

/** The citation a publication shows when none is written: `<authors> (<year>). <title>. <venue>.` */
export function citationPreview(p: {
  authors: string;
  year: string | number;
  title: string;
  venue: string;
  citation?: string | null;
}): string {
  const own = p.citation?.trim();
  if (own) return own;
  const authors = p.authors.trim() || "Authors";
  const title = p.title.trim().replace(/\.+$/, "") || "Title";
  const venue = p.venue.trim().replace(/\.+$/, "") || "Venue";
  return `${authors} (${String(p.year).trim() || "Year"}). ${title}. ${venue}.`;
}

/** The label a tutorial's action button shows when none is written. */
export function defaultActionLabel(kind: TutorialKind): string {
  switch (kind) {
    case "notebook":
      return "Open notebook";
    case "video":
      return "Watch video";
    default:
      return "Start tutorial";
  }
}

/** The list with the item at `from` moved to `to`; the same list when either is out of range. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** The most an address may be, as the backend stores it. */
export const MAX_URL_LENGTH = 2048;

const UNSAFE_URL_CHARS = /[\u0000-\u001f\u007f\s\\]/;

/** An address a link may carry, as the backend takes it: `http(s)://` with a
 *  host, `mailto:`, or a path on this site starting with a single `/` (which
 *  includes an uploaded file's address). */
export function isValidLinkUrl(url: string): boolean {
  if (!url || url.length > MAX_URL_LENGTH || UNSAFE_URL_CHARS.test(url)) return false;
  if (url.startsWith("/")) return !url.startsWith("//");
  return /^https?:\/\/[^/?#:@]/i.test(url) || /^mailto:./i.test(url);
}

/** The address of a card image, as the backend takes it: `https://`, or a file
 *  uploaded to the Community page. */
export function isValidImageUrl(url: string): boolean {
  if (!url || url.length > MAX_URL_LENGTH || UNSAFE_URL_CHARS.test(url)) return false;
  return /^https:\/\/[^/?#:@]/i.test(url) || /^\/api\/community\/files\/[0-9a-f]{24}$/.test(url);
}
