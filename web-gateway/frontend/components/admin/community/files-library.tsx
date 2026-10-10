"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, FileText, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/admin/admin-states";
import { DeleteButton, DeleteItemsDialog, type Item } from "@/components/admin/community/content-actions";
import { FileUploadButton } from "@/components/admin/community/file-upload-button";
import { ImagePreview } from "@/components/admin/community/image-field";
import { RowMenu } from "@/components/admin/community/row-menu";
import { SelectionBar, useSelection } from "@/components/admin/community/selection";
import { TimeStamp } from "@/components/common/time-stamp";
import { fileExtension, formatFileSize, isImageType } from "@/lib/community/admin-format";
import { cn } from "@/lib/utils";
import type { CommunityFile } from "@/lib/community/types";

/** Copies a file's address to the clipboard and says so, as the Copy button does elsewhere. */
async function copyAddress(file: CommunityFile) {
  try {
    await navigator.clipboard.writeText(file.url);
    toast.success(`Copied the address of ${file.filename}.`);
  } catch {
    toast.error(`Could not copy the address of ${file.filename}. Select it and copy by hand.`);
  }
}

/**
 * The media library: every file uploaded for Community content, newest first.
 * Images show as thumbnails and other files by their type. A tile's checkbox
 * selects it for the Delete in the bar above, and its "⋯" has Copy address
 * (the address content stores on the clipboard, `/api/community/files/<id>`)
 * and Delete. Deleting asks first, because a page that uses the file would
 * show a broken link or image; the library cannot tell which pages those are.
 */
export function FilesLibrary({ files }: { files: CommunityFile[] }) {
  const router = useRouter();
  const selection = useSelection(files.map((f) => f.id));
  const [deleting, setDeleting] = useState<Item[] | null>(null);
  const asItems = (list: CommunityFile[]): Item[] => list.map((f) => ({ id: f.id, title: f.filename }));

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <CardTitle>{files.length === 1 ? "1 file" : `${files.length} files`}</CardTitle>
          <CardDescription>Photos and materials are uploaded where you use them; this is where they all end up.</CardDescription>
        </div>
        <FileUploadButton kind="file" label="Upload files" multiple variant="default" onUploaded={() => router.refresh()} />
      </CardHeader>

      <CardContent>
        {files.length === 0 ? (
          <EmptyState title="No files yet.">Upload an image or a document here, or from a workshop or tutorial.</EmptyState>
        ) : (
          <>
            <SelectionBar selection={selection} label="files" layout="grid">
              <DeleteButton busy={false} onClick={() => setDeleting(asItems(files.filter((f) => selection.has(f.id))))} />
            </SelectionBar>
            <ul className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {files.map((file) => {
                const selected = selection.has(file.id);
                return (
                  <li key={file.id}>
                    <div
                      data-state={selected ? "selected" : undefined}
                      className={cn("h-full rounded-xl border transition-colors", selected ? "border-primary/60 bg-secondary/40" : "border-border")}
                    >
                      <div className="flex h-full flex-col gap-3 p-3">
                        <div className="relative">
                          {isImageType(file.content_type) ? (
                            <ImagePreview src={file.url} className="aspect-[4/3] w-full" />
                          ) : (
                            <div className="grid aspect-[4/3] w-full place-items-center rounded-xl bg-muted text-muted-foreground">
                              <span className="flex flex-col items-center gap-1.5">
                                <FileText className="size-6" aria-hidden="true" />
                                <span className="font-mono text-xs tracking-[0.06em] uppercase">
                                  {fileExtension(file.filename) || "file"}
                                </span>
                              </span>
                            </div>
                          )}
                          <span className="absolute top-2 left-2 grid size-8 place-items-center rounded-lg bg-card/90 shadow-xs">
                            <Checkbox
                              aria-label={`Select ${file.filename}`}
                              checked={selected}
                              onCheckedChange={(value) => selection.toggle(file.id, value === true)}
                            />
                          </span>
                          <RowMenu
                            title={file.filename}
                            className="absolute top-2 right-2 bg-card/90 shadow-xs hover:bg-card"
                            actions={[
                              { key: "copy", label: "Copy address", icon: Copy, onSelect: () => void copyAddress(file) },
                              { key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => setDeleting(asItems([file])) },
                            ]}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium break-words text-foreground [overflow-wrap:anywhere]">{file.filename}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {formatFileSize(file.size)} · <TimeStamp value={file.uploaded_at} format="date" />
                          </p>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardContent>

      <DeleteItemsDialog
        noun="files"
        targets={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={selection.drop}
      />
    </Card>
  );
}
