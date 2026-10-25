import type { FileSource, ListedFile, TreeErrorCode, TreeKind } from "@/lib/repository/types";

/** How much of a file the backend reads for a preview (`Range: bytes=0-262143`). */
export const PREVIEW_BYTES = 256 * 1024;

/** The backend route of a published tree, up to its id: `/api/v1/repository/<kind>/<id>`. */
export function treeRoute(kind: TreeKind, id: string): string {
  const segment = kind === "snapshot" ? "datasets" : "model-inputs";
  return `/api/v1/repository/${segment}/${encodeURIComponent(id)}`;
}

/**
 * The gateway's own routes for a source's folders, the browser never calls FastAPI: a tree's
 * under `app/api/repository`, a run's (`id` is the job's) under `app/api/jobs`.
 */
function filesApi(kind: FileSource, id: string): string {
  if (kind === "run") return `/api/jobs/${encodeURIComponent(id)}/files`;
  const segment = kind === "snapshot" ? "datasets" : "model-inputs";
  return `/api/repository/${segment}/${encodeURIComponent(id)}/files`;
}

/** `GET`: what a folder holds, at any depth, and whether it is small enough for a ZIP. */
export function folderSummaryRoute(kind: FileSource, id: string, folder: string): string {
  return `${filesApi(kind, id)}/folder?path=${encodeURIComponent(folder).replaceAll("%2F", "/")}`;
}

/**
 * `GET`: one page of one folder of a run's output (`folder` is `""` for the output directory,
 * else ends with `/`), the next page when `cursor` is the previous one's `nextCursor`.
 */
export function runListingRoute(jobId: string, folder: string, cursor?: string | null): string {
  const query = [`path=${encodeURIComponent(folder).replaceAll("%2F", "/")}`];
  if (cursor) query.push(`cursor=${encodeURIComponent(cursor)}`);
  return `${filesApi("run", jobId)}?${query.join("&")}`;
}

/**
 * `POST` a form of `folder` and a `names` field for each entry (a folder's
 * name ends with `/`): the entries as one ZIP. A form, so that the browser
 * itself takes the stream to disk and the names are not squeezed into a URL.
 */
export function archiveRoute(kind: FileSource, id: string): string {
  return `${filesApi(kind, id)}/archive`;
}

/** A folder as the listing route names it: `""` for the root, else ending with `/`. */
export function normalizeFolder(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

/** The folder a file is in: `a/b/c.txt` -> `a/b/`, `c.txt` -> `` (the root). */
export function parentFolder(filePath: string): string {
  const cut = filePath.lastIndexOf("/");
  return cut < 0 ? "" : filePath.slice(0, cut + 1);
}

/** The folders from the root down to `folder`, for breadcrumbs: `a/b/` -> `a/`, `a/b/`. */
export function folderCrumbs(folder: string): { name: string; path: string }[] {
  const names = folder.split("/").filter((s) => s !== "");
  return names.map((name, i) => ({ name, path: `${names.slice(0, i + 1).join("/")}/` }));
}

/**
 * The URL of the files page at `folder`, with `file` open. `/` stays readable
 * in the query (`?path=wbm_output/daily/`), which the URL syntax allows.
 */
export function treeHref(pathname: string, folder: string, file: string | null = null): string {
  const parts: string[] = [];
  if (folder) parts.push(`path=${encodeURIComponent(folder).replaceAll("%2F", "/")}`);
  if (file) parts.push(`file=${encodeURIComponent(file).replaceAll("%2F", "/")}`);
  return parts.length > 0 ? `${pathname}?${parts.join("&")}` : pathname;
}

/**
 * The public URL of the tree's root (`…/snapshots/<id>/`), read off a listed
 * file whose URL ends with its path. A page opened on `?file=` may not list
 * that file (it can be on a later page of a big folder), but its URL is the
 * root's plus its path. Null when no listed file tells.
 */
export function treeBaseUrl(files: ListedFile[]): string | null {
  for (const f of files) {
    if (f.url && f.path && f.url.endsWith(f.path)) return f.url.slice(0, f.url.length - f.path.length);
  }
  return null;
}

/** A `.json` file's text, pretty-printed when it parses; otherwise as it is. */
export function displayText(path: string, text: string): string {
  if (!path.toLowerCase().endsWith(".json")) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

const CODES: readonly TreeErrorCode[] = [
  "invalid_path",
  "path_not_found",
  "listing_unavailable",
  "preview_unavailable",
];

/**
 * The code of what Axios threw for a listing or a preview. The backend's
 * `detail` is `{ code, message }` for the answers the page has a state for;
 * a plain 404 is an id the catalogue does not hold; anything else (no answer,
 * a 5xx, a body of another shape) is the route's own "unavailable", which the
 * page offers to retry.
 */
export function treeFailureCode(error: unknown, unavailable: TreeErrorCode): TreeErrorCode {
  const response = (error as { response?: { status?: number; data?: { detail?: unknown } } } | null)
    ?.response;
  const detail = response?.data?.detail;
  if (detail && typeof detail === "object") {
    const code = (detail as { code?: unknown }).code;
    const known = CODES.find((c) => c === code);
    if (known) return known;
  }
  if (response?.status === 404) return "not_found";
  return unavailable;
}
