"use client";

import { AlertCircle, FileQuestion, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyUrlButton } from "@/components/repository/tree-file-actions";
import { pushOnPlainClick } from "@/components/workspace/my-data-kind-tabs";
import { displayText } from "@/lib/repository/tree-browse";
import type { TreeErrorCode, TreePreview } from "@/lib/repository/types";
import { formatBytes } from "@/lib/workspace/format";

/** What the sheet shows of the file: the preview's state. */
export type PreviewView =
  | { status: "loading" }
  /** The listing says the file is not previewable: the backend was not asked. */
  | { status: "skipped" }
  | { status: "ready"; preview: TreePreview }
  | { status: "error"; code: TreeErrorCode };

/**
 * The side sheet over the files page: one file's first bytes in a monospace
 * block with line numbers, and its download and copy-URL buttons. Open while
 * `?file=` names a file. `url` is null when no listed file tells the tree's
 * root (the file is not in what the page has loaded); the buttons are then
 * left out rather than guessed.
 */
export function TreePreviewSheet({
  file,
  url,
  view,
  rootHref,
  onClose,
  onRetry,
}: {
  /** The open file's path from the tree's root; null closes the sheet. */
  file: string | null;
  url: string | null;
  view: PreviewView;
  /** The URL of the tree's root, which a missing or invalid path links to. */
  rootHref: string;
  onClose: () => void;
  onRetry: () => void;
}) {
  const name = file ? file.slice(file.lastIndexOf("/") + 1) : "";
  return (
    <Sheet open={file !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="break-all font-mono text-sm">{name}</SheetTitle>
          <SheetDescription className="break-all font-mono text-xs">{file}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <PreviewBody
            file={file ?? ""}
            view={view}
            url={url}
            rootHref={rootHref}
            onRetry={onRetry}
          />
        </SheetBody>
        {url && (
          <SheetFooter className="justify-end">
            <CopyUrlButton url={url} label={name} />
            <Button variant="outline" size="sm" asChild>
              <a href={url} target="_blank" rel="noopener noreferrer">
                Download
              </a>
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PreviewBody({
  file,
  view,
  url,
  rootHref,
  onRetry,
}: {
  file: string;
  view: PreviewView;
  url: string | null;
  rootHref: string;
  onRetry: () => void;
}) {
  if (view.status === "loading") {
    return (
      <div className="space-y-2" role="status" aria-label="Loading preview">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <Skeleton key={i} className="h-4" style={{ width: `${95 - ((i * 13) % 45)}%` }} />
        ))}
      </div>
    );
  }
  if (view.status === "skipped" || (view.status === "ready" && view.preview.kind === "binary")) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <FileQuestion className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">No preview for this file</p>
        <p className="text-sm text-muted-foreground">
          {view.status === "ready"
            ? `It is binary, ${formatBytes(view.preview.size)}.`
            : "It is a binary format."}
          {url ? " Download it to open it." : ""}
        </p>
      </div>
    );
  }
  if (view.status === "error") {
    if (view.code === "preview_unavailable") {
      return (
        <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertCircle className="size-8 text-amber-500" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            The preview is unavailable right now. The storage service did not answer.
          </p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCw className="size-4" />
            Retry
          </Button>
        </div>
      );
    }
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
        <AlertCircle className="size-8 text-amber-500" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          {view.code === "invalid_path"
            ? "That is not a valid file path."
            : "This file is not in the tree."}
        </p>
        <a
          href={rootHref}
          onClick={pushOnPlainClick(rootHref)}
          className="text-sm text-[#006994] hover:underline"
        >
          Back to the root of the tree
        </a>
      </div>
    );
  }

  const { preview } = view;
  const text = displayText(file, preview.text ?? "");
  const lines = text.split("\n");
  // A file that ends with a newline has no last, empty line.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return (
    <div className="space-y-3">
      {preview.truncated && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing the first 256 KB of {formatBytes(preview.size)}. Download it for the whole file.
        </p>
      )}
      {preview.text === "" ? (
        <p className="text-sm text-muted-foreground">The file is empty.</p>
      ) : (
        <div className="flex overflow-hidden rounded-lg border bg-slate-50 font-mono text-xs leading-5">
          <pre
            aria-hidden="true"
            data-testid="line-numbers"
            className="select-none border-r bg-slate-100 px-3 py-3 text-right text-slate-400"
          >
            {lines.map((_, i) => i + 1).join("\n")}
          </pre>
          <pre data-testid="preview-text" className="min-w-0 flex-1 overflow-x-auto px-3 py-3 text-slate-800">
            {lines.join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
}
