"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/admin/admin-states";
import { ConfirmActionDialog } from "@/components/admin/confirm-action-dialog";
import { FileUploadButton } from "@/components/admin/community/file-upload-button";
import { ImagePreview } from "@/components/admin/community/image-field";
import { CopyButton } from "@/components/workspace/copy-button";
import { TimeStamp } from "@/components/common/time-stamp";
import { deleteCommunityFile } from "@/lib/community/admin-actions";
import { fileExtension, formatFileSize, isImageType } from "@/lib/community/admin-format";
import type { CommunityFile } from "@/lib/community/types";

/**
 * The media library: every file uploaded for Community content, newest first.
 * Images show as thumbnails and other files by their type. Copy address puts
 * the address content stores on the clipboard (`/api/community/files/<id>`).
 * Deleting asks first, because a page that uses the file would show a broken
 * link or image; the library cannot tell which pages those are.
 */
export function FilesLibrary({ files }: { files: CommunityFile[] }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<CommunityFile | null>(null);

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
          <ul className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {files.map((file) => (
              <li key={file.id}>
                <div className="h-full rounded-xl border border-border">
                  <div className="flex h-full flex-col gap-3 p-3">
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
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium break-words text-foreground [overflow-wrap:anywhere]">{file.filename}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatFileSize(file.size)} · <TimeStamp value={file.uploaded_at} format="date" />
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <CopyButton text={file.url} label={`address of ${file.filename}`} className="flex-1" />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-10 text-muted-foreground hover:text-destructive sm:size-8"
                        aria-label={`Delete ${file.filename}`}
                        onClick={() => setDeleting(file)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <ConfirmActionDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this file?"
        description="The file is gone for good. If a workshop, tutorial or page uses it, that page shows a broken image or link until you change it."
        detail={deleting?.filename}
        confirmLabel="Delete file"
        pendingLabel="Deleting…"
        successMessage="File deleted."
        failureMessage="Couldn't delete the file. Try again. If it keeps failing, the service may be unavailable."
        onConfirm={async () => {
          if (!deleting) return { ok: false };
          const result = await deleteCommunityFile(deleting.id);
          if (result.ok) return { ok: true };
          if (result.reason === "session_expired") return { ok: false, message: "Your session has expired. Sign in again." };
          if (result.reason === "not_found") return { ok: true };
          return { ok: false, message: result.message };
        }}
        onDone={() => {
          setDeleting(null);
          router.refresh();
        }}
      />
    </Card>
  );
}
