import type { FolderTotal, ListedFile } from "@/lib/repository/types";
import { s3SyncCommand } from "@/lib/repository/output";
import { treeBaseUrl } from "@/lib/repository/tree-browse";
import { formatBytes } from "@/lib/workspace/format";

/**
 * What one ZIP may hold before compression (ADR 0036). The backend decides, from
 * its own listing, and refuses a larger one with 413; this is only for telling
 * a person before they click, when the selection holds no folder to say so.
 */
export const ZIP_LIMIT_BYTES = 500 * 1024 * 1024;

/** "500 MB": a limit as the sizes beside it are written, without the `.0`. */
export function limitLabel(bytes: number): string {
  return formatBytes(bytes).replace(".0 ", " ");
}

/** What is known of a selected folder's size: absent while its summary is on its way. */
export type FolderSize =
  | { status: "ready"; summary: FolderTotal }
  | { status: "failed" };

export type SelectionStatus = "ok" | "checking" | "over" | "incomplete" | "failed";

export interface SelectionTotals {
  count: number;
  /** The files' sizes and the folders' summaries that have come. */
  bytes: number;
  limit: number;
  status: SelectionStatus;
  /** The selected folders whose size could not be had, as their names (`daily/`). */
  failed: string[];
}

/**
 * The size of a selection: `names` are entries of one folder (a folder's name
 * ends with `/`), `files` what is loaded of it, `sizes` the summary of each
 * selected folder by name. Over the limit wins at once, even with folders still
 * to be counted, since they can only add to it; a folder listed only in part is
 * over. Then a failed summary, then one still on its way.
 */
export function selectionTotals(
  names: string[],
  files: ListedFile[],
  sizes: Record<string, FolderSize | undefined>
): SelectionTotals {
  const byName = new Map(files.map((f) => [f.name, f.size]));
  let bytes = 0;
  let limit = ZIP_LIMIT_BYTES;
  let checking = false;
  let incomplete = false;
  const failed: string[] = [];
  for (const name of names) {
    if (!name.endsWith("/")) {
      bytes += byName.get(name) ?? 0;
      continue;
    }
    const size = sizes[name];
    if (!size) checking = true;
    else if (size.status === "failed") failed.push(name);
    else {
      bytes += size.summary.bytes;
      limit = size.summary.limit_bytes;
      if (!size.summary.complete) incomplete = true;
    }
  }
  let status: SelectionStatus = "ok";
  if (incomplete) status = "incomplete";
  else if (bytes > limit) status = "over";
  else if (failed.length > 0) status = "failed";
  else if (checking) status = "checking";
  return { count: names.length, bytes, limit, status, failed };
}

/**
 * The public URL of the folder being viewed (`folder` is `""` at the tree's
 * root, else ends with `/`). The loaded files know the tree's base URL; failing
 * that, a ticked folder's summary carries its own URL, which is the viewed
 * folder's plus its name. Null when neither has been loaded.
 */
function viewedFolderUrl(
  folder: string,
  names: string[],
  files: ListedFile[],
  sizes: Record<string, FolderSize | undefined>
): string | null {
  const base = treeBaseUrl(files);
  if (base) return base + folder;
  for (const name of names) {
    const size = sizes[name];
    if (name.endsWith("/") && size?.status === "ready" && size.summary.url) {
      for (const spelled of [name, encodeURI(name)]) {
        if (size.summary.url.endsWith(spelled)) return size.summary.url.slice(0, -spelled.length);
      }
    }
  }
  return null;
}

/**
 * The `aws s3 sync` that brings down what is ticked, for a selection too big
 * for one ZIP. One folder is synced as it is, into a folder of its name. Any
 * other selection syncs the viewed folder with filters that let only the
 * ticked entries through (a folder as `name/*`, a file by its name), into a
 * folder named for the viewed one (the artifact `id` at the tree's root), so
 * the layout under it is kept. Null while the viewed folder's URL is not known,
 * and then there is no command to show.
 */
export function selectionS3Command({
  id,
  folder,
  names,
  files,
  sizes,
}: {
  id: string;
  folder: string;
  names: string[];
  files: ListedFile[];
  sizes: Record<string, FolderSize | undefined>;
}): string | null {
  if (names.length === 0) return null;
  const url = viewedFolderUrl(folder, names, files, sizes);
  if (!url) return null;
  if (names.length === 1 && names[0].endsWith("/")) {
    return s3SyncCommand(url, names[0], `./${names[0].slice(0, -1)}`);
  }
  const into = folder.split("/").filter(Boolean).pop() ?? id;
  const only = names.map((name) => (name.endsWith("/") ? `${name}*` : name));
  return s3SyncCommand(url, "", `./${into}`, only);
}
