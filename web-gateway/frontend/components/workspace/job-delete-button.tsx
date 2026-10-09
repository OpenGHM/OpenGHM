"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteDraftDialog } from "@/components/workspace/delete-draft-dialog";
import type { FilesState } from "@/lib/jobs/types";

/**
 * The band's Delete button (a draft, or a job that has ended; the backend
 * refuses an active one). It opens `DeleteDraftDialog`, which says what
 * goes, and the dialog hands focus back to the button when it closes without
 * a delete.
 */
export function JobDeleteButton({
  jobId,
  isDraft,
  workDir,
  remoteJobDir,
  files,
  preview = false,
  onOpen,
  onOpenChange,
  onDeleted,
  onError,
  onSessionExpired,
}: {
  jobId: string;
  isDraft: boolean;
  /** The simulation's output directory on Anvil. */
  workDir: string | null;
  /** slurmly's directory: the batch script and its logs. */
  remoteJobDir: string | null;
  files: FilesState | null;
  /** Fixture data: there is no real job behind `jobId`. */
  preview?: boolean;
  /** The dialog is about to open: the caller clears an earlier failure. */
  onOpen?: () => void;
  /** The dialog opened or closed. A delete that went through calls `onDeleted`
   *  first, so a caller can tell closing from deleting. */
  onOpenChange?: (open: boolean) => void;
  /** Called instead of going to `/workspace` once the snapshot draft is gone. */
  onDeleted?: () => void;
  /** The delete failed and the snapshot draft still exists. */
  onError?: (message: string) => void;
  onSessionExpired?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="on-dark"
        onClick={() => {
          onOpen?.();
          setOpen(true);
          onOpenChange?.(true);
        }}
        className="min-h-10 shrink-0 gap-2 border-hero-error/40 bg-white/5 text-hero-error hover:border-hero-error/60 hover:bg-destructive/25 hover:text-white"
      >
        <Trash2 aria-hidden="true" />
        Delete snapshot draft
      </Button>

      <DeleteDraftDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          onOpenChange?.(next);
        }}
        onDeleted={onDeleted}
        jobId={jobId}
        isDraft={isDraft}
        workDir={workDir}
        remoteJobDir={remoteJobDir}
        files={files}
        preview={preview}
        onError={onError}
        onSessionExpired={onSessionExpired}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      />
    </>
  );
}
