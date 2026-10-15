"use client";

import { File as FileIcon, FileText, Folder } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CopyUrlButton, DownloadLink } from "@/components/repository/tree-file-actions";
import type { TreeSelection } from "@/components/repository/use-tree-selection";
import { pushOnPlainClick } from "@/components/workspace/my-data-kind-tabs";
import { treeHref } from "@/lib/repository/tree-browse";
import type { TreeFile, TreeFolder } from "@/lib/repository/types";
import { formatBytes } from "@/lib/workspace/format";
import { formatUtcDate, formatUtcDateTime } from "@/lib/workspace/time";

const FOLDER_CLASS =
  "inline-flex items-center gap-2 text-left font-mono text-[13px] font-medium break-all text-primary outline-none hover:text-primary-hover hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * One folder's entries: folders first, then files, each in the order the
 * backend sent. On the files page a folder and a previewable file are links to
 * their own URL (`?path=`, `?file=`), so each opens in a new tab as well; a
 * plain click only pushes the URL and the page follows it. Given
 * `onOpenFolder` (a browser inside a dialog, which keeps its folder in state),
 * a folder is a button that calls it and a file is not opened for preview.
 *
 * Given `selection`, each row starts with a checkbox, and the header's ticks or
 * clears every row loaded so far (a dash when only some are ticked). An entry is
 * known to the selection by its name, a folder's ending with `/`.
 */
export function TreeBrowserTable({
  pathname,
  folder,
  folders,
  files,
  onOpenFolder,
  selection,
}: {
  pathname: string;
  /** The folder listed, as in `?path=`. */
  folder: string;
  folders: TreeFolder[];
  files: TreeFile[];
  onOpenFolder?: (path: string) => void;
  selection?: Pick<TreeSelection, "names" | "toggle" | "setAll" | "clear">;
}) {
  const everyName = [...folders.map((f) => `${f.name}/`), ...files.map((f) => f.name)];
  const ticked = selection ? everyName.filter((n) => selection.names.includes(n)).length : 0;
  const nameCell = selection ? "pl-1" : "pl-6";
  const tick = (name: string, label: string) =>
    selection && (
      <TableCell className="w-10 pl-6 pr-0">
        <Checkbox
          checked={selection.names.includes(name)}
          onCheckedChange={() => selection.toggle(name)}
          aria-label={`Select ${label}`}
        />
      </TableCell>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {selection && (
            <TableHead className="w-10 pl-6 pr-0">
              <Checkbox
                checked={ticked === 0 ? false : ticked === everyName.length ? true : "indeterminate"}
                onCheckedChange={() => (ticked === everyName.length ? selection.clear() : selection.setAll(everyName))}
                aria-label="Select all"
              />
            </TableHead>
          )}
          <TableHead className={nameCell}>Name</TableHead>
          <TableHead className="w-28 text-right">Size</TableHead>
          <TableHead className="w-32">Modified</TableHead>
          <TableHead className="w-24 pr-6 text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {folders.map((f) => {
          const href = treeHref(pathname, f.path);
          return (
            <TableRow key={`d:${f.path}`} data-state={selection?.names.includes(`${f.name}/`) ? "selected" : undefined}>
              {tick(`${f.name}/`, `${f.name}/`)}
              <TableCell className={nameCell}>
                {onOpenFolder ? (
                  <button
                    type="button"
                    onClick={() => onOpenFolder(f.path)}
                    className={FOLDER_CLASS}
                  >
                    <Folder className="size-4 shrink-0 text-primary" aria-hidden="true" />
                    {f.name}/
                  </button>
                ) : (
                  <a href={href} onClick={pushOnPlainClick(href)} className={FOLDER_CLASS}>
                    <Folder className="size-4 shrink-0 text-primary" aria-hidden="true" />
                    {f.name}/
                  </a>
                )}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">—</TableCell>
              <TableCell className="text-muted-foreground">—</TableCell>
              <TableCell className="pr-6" />
            </TableRow>
          );
        })}
        {files.map((f) => {
          const href = treeHref(pathname, folder, f.path);
          return (
            <TableRow key={`f:${f.path}`} data-state={selection?.names.includes(f.name) ? "selected" : undefined}>
              {tick(f.name, f.name)}
              <TableCell className={nameCell}>
                {f.previewable && !onOpenFolder ? (
                  <a
                    href={href}
                    onClick={pushOnPlainClick(href)}
                    className="inline-flex items-center gap-2 font-mono text-[13px] break-all text-foreground hover:text-primary hover:underline"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    {f.name}
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-2 font-mono text-[13px] break-all text-foreground">
                    <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    {f.name}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatBytes(f.size)}
              </TableCell>
              <TableCell
                className="whitespace-nowrap text-muted-foreground"
                title={formatUtcDateTime(f.lastModified)}
              >
                {formatUtcDate(f.lastModified)}
              </TableCell>
              <TableCell className="pr-6">
                <div className="flex justify-end gap-0.5">
                  <DownloadLink url={f.url} label={f.name} />
                  <CopyUrlButton url={f.url} label={f.name} />
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
