import type { OutputFile } from "@/lib/jobs/types";

export interface ManifestGroup {
  /** Top folder, or `""` for files directly under the work directory. */
  folder: string;
  fileCount: number;
  totalBytes: number;
  /** Paths relative to `folder`. */
  files: { name: string; bytes: number }[];
}

/**
 * Groups a manifest by its top folder (`daily/`, `monthly/`, `yearly/`, ...).
 * Folders come in the order they first appear; files keep the manifest's order.
 * Files with no folder go in one group with `folder: ""`, listed last.
 */
export function groupManifest(files: OutputFile[]): ManifestGroup[] {
  const groups = new Map<string, ManifestGroup>();
  for (const f of files) {
    const slash = f.path.indexOf("/");
    const folder = slash === -1 ? "" : f.path.slice(0, slash);
    const name = slash === -1 ? f.path : f.path.slice(slash + 1);
    let group = groups.get(folder);
    if (!group) {
      group = { folder, fileCount: 0, totalBytes: 0, files: [] };
      groups.set(folder, group);
    }
    group.fileCount += 1;
    group.totalBytes += f.bytes;
    group.files.push({ name, bytes: f.bytes });
  }
  const all = [...groups.values()];
  return [...all.filter((g) => g.folder !== ""), ...all.filter((g) => g.folder === "")];
}

export interface ShownGroup extends ManifestGroup {
  /** The files to draw: `files`, cut so that all groups together stay within the budget. */
  rows: ManifestGroup["files"];
}

/** Keeps at most `maxRows` file rows across the groups, in order. */
export function limitRows(groups: ManifestGroup[], maxRows: number): ShownGroup[] {
  let left = Math.max(0, maxRows);
  return groups.map((g) => {
    const rows = g.files.slice(0, left);
    left -= rows.length;
    return { ...g, rows };
  });
}
