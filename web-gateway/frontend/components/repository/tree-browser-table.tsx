"use client";

import { File as FileIcon, FileText, Folder } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CopyUrlButton, DownloadLink } from "@/components/repository/tree-file-actions";
import { pushOnPlainClick } from "@/components/workspace/my-data-kind-tabs";
import { treeHref } from "@/lib/repository/tree-browse";
import type { TreeFile, TreeFolder } from "@/lib/repository/types";
import { formatBytes } from "@/lib/workspace/format";
import { formatUtcDate, formatUtcDateTime } from "@/lib/workspace/time";

/**
 * One folder's entries: folders first, then files, each in the order the
 * backend sent. A folder and a previewable file are links to their own URL
 * (`?path=`, `?file=`), so each opens in a new tab as well; a plain click only
 * pushes the URL and the page follows it.
 */
export function TreeBrowserTable({
  pathname,
  folder,
  folders,
  files,
}: {
  pathname: string;
  /** The folder listed, as in `?path=`. */
  folder: string;
  folders: TreeFolder[];
  files: TreeFile[];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50/60 hover:bg-slate-50/60">
          <TableHead className="pl-6">Name</TableHead>
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
            <TableRow key={`d:${f.path}`}>
              <TableCell className="pl-6">
                <a
                  href={href}
                  onClick={pushOnPlainClick(href)}
                  className="inline-flex items-center gap-2 break-all font-medium text-[#006994] hover:underline"
                >
                  <Folder className="size-4 shrink-0 text-sky-500" aria-hidden="true" />
                  {f.name}/
                </a>
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
            <TableRow key={`f:${f.path}`}>
              <TableCell className="pl-6">
                {f.previewable ? (
                  <a
                    href={href}
                    onClick={pushOnPlainClick(href)}
                    className="inline-flex items-center gap-2 break-all text-foreground hover:text-[#006994] hover:underline"
                  >
                    <FileText className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
                    {f.name}
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-2 break-all text-foreground">
                    <FileIcon className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
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
