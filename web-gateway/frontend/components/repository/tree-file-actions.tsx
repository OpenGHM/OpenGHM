"use client";

import { Download } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { useDownload } from "@/components/download/download-provider";
import type { DownloadJob } from "@/lib/download/engine";
import { headContentType, saveInBrowser, showsInline } from "@/lib/download/browser-download";
import { runFileRoute } from "@/lib/repository/tree-browse";
import type { FileSource } from "@/lib/repository/types";
import { formatBytes } from "@/lib/workspace/format";
import { cn } from "@/lib/utils";

/**
 * Copies a file's public URL. Icon-only, for a table row; the label names the
 * file for a screen reader.
 */
export function CopyUrlButton({ url, label }: { url: string; label: string }) {
  return (
    <CopyButton
      text={url}
      label={`URL of ${label}`}
      iconOnly
      idleTitle="Copy URL"
      iconClassName="size-4"
      copiedIconClassName="text-success"
      className={cn(
        buttonVariants({ variant: "ghost", size: "icon-sm" }),
        "text-muted-foreground hover:text-foreground"
      )}
    />
  );
}

/**
 * The download dialog's job for one file (ADR 0043). A published file is read from its S3 URL by
 * the page itself (the bucket allows this site's origins by CORS), so no byte passes through the
 * gateway; a run's file is not in S3 and comes from the gateway, read on Anvil.
 */
export function fileDownloadJob(
  kind: FileSource,
  id: string,
  folder: string,
  file: { name: string; size: number; url?: string | null }
): DownloadJob {
  const base = { title: `${file.name} · ${formatBytes(file.size)}`, filename: file.name, expectedBytes: file.size };
  if (kind !== "run" && file.url) {
    return { ...base, url: file.url, direct: true, note: "Connecting to the storage. This takes a moment." };
  }
  return {
    ...base,
    url: runFileRoute(id, `${folder}${file.name}`),
    native: true,
    note: "Anvil is opening the file. For a large file this can take a minute.",
  };
}

/**
 * Downloads one file of a tree or of a run's output. A published object the browser would save
 * anyway is handed to the browser at its S3 URL (its own download, no dialog, no byte through the
 * page); one it would show (text, JSON) is read by the page and saved, and so is a run's file,
 * which only the gateway can read. Those two go through the download dialog, which opens only
 * when they take a while.
 */
export function useFileDownload(): (
  kind: FileSource,
  id: string,
  folder: string,
  file: { name: string; size: number; url?: string | null }
) => void {
  const { start } = useDownload();
  return (kind, id, folder, file) => {
    const job = fileDownloadJob(kind, id, folder, file);
    if (!job.direct) {
      start(job);
      return;
    }
    void headContentType(job.url).then((type) => {
      if (type !== undefined && !showsInline(type)) saveInBrowser(job.url);
      else start(job);
    });
  };
}

/**
 * The download button of a file: the file as it is, saved (never shown in the browser), see
 * `useFileDownload`.
 */
export function FileDownloadButton({
  kind,
  id,
  folder,
  name,
  size,
  url,
}: {
  kind: FileSource;
  id: string;
  folder: string;
  name: string;
  size: number;
  url?: string | null;
}) {
  const download = useFileDownload();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground hover:text-foreground"
      aria-label={`Download ${name}`}
      title="Download"
      onClick={() => download(kind, id, folder, { name, size, url })}
    >
      <Download className="size-4" />
    </Button>
  );
}
