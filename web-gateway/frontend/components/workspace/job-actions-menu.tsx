"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Copy, Ellipsis, FlaskConical, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DeleteDraftDialog } from "@/components/workspace/delete-draft-dialog";
import { errorMessage } from "@/components/workspace/duplicate-draft-button";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { useCreateDraft } from "@/lib/jobs/use-create-draft";
import type { FilesState } from "@/lib/jobs/types";
import { newStepHref } from "@/lib/workspace/draft-wizard";
import { cn } from "@/lib/utils";

/**
 * The header's actions of an ended job on a phone, in one "More actions" menu
 * instead of three full-width buttons above the page's content (`JobHeader`
 * shows this below `sm` and the buttons from it). None of the three is the
 * page's main action, so none is pulled out of the menu. Each item does what
 * its button does: "Duplicate" (only where the header offers it) the same copy
 * (`useCreateDraft`, the same toast and message on a failure), "New from this
 * model snapshot" the same link, and "Delete snapshot draft" the same
 * confirmation (`DeleteDraftDialog`), in the destructive colour.
 *
 * The dialog and the copy live here, outside the menu: the menu's content is
 * gone once an item is chosen, and a dialog or a pending copy inside it would
 * go with it. Focus goes back to the menu button when the dialog closes
 * without a delete.
 */
export function JobActionsMenu({
  jobId,
  datasetId,
  offersDuplicate,
  workDir,
  remoteJobDir,
  files,
  preview = false,
  onDeleteOpen,
  onDeleteError,
  onDeleteSessionExpired,
  className,
}: {
  jobId: string;
  datasetId: string;
  /** The header offers "Duplicate" (a completed job: no other copy action on the page). */
  offersDuplicate: boolean;
  workDir: string | null;
  remoteJobDir: string | null;
  files: FilesState | null;
  preview?: boolean;
  /** The delete dialog is about to open: the caller clears an earlier failure. */
  onDeleteOpen?: () => void;
  onDeleteError?: (message: string) => void;
  onDeleteSessionExpired?: () => void;
  className?: string;
}) {
  const { pending, error, duplicateFrom } = useCreateDraft();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // `error` is a new object for every failure, so a second identical one toasts again.
  useEffect(() => {
    if (error) toast.error(errorMessage(error));
  }, [error]);

  return (
    <div className={cn("flex max-w-full flex-col items-start gap-1.5", className)}>
      {/* Not modal: a modal menu locks the page's pointer events, and the delete
          dialog opens as it closes. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button ref={triggerRef} type="button" variant="on-dark" className="min-h-10 shrink-0 gap-2 font-medium">
            {pending ? (
              <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <Ellipsis aria-hidden="true" />
            )}
            More actions
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {offersDuplicate && (
            <DropdownMenuItem
              disabled={pending}
              onSelect={() => void duplicateFrom(jobId)}
              className="min-h-10 text-[15px] font-medium"
            >
              <Copy />
              Duplicate
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild className="min-h-10 text-[15px] font-medium">
            <Link href={newStepHref(datasetId, "run")}>
              <FlaskConical />
              New from this model snapshot
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              onDeleteOpen?.();
              setDeleteOpen(true);
            }}
            className="min-h-10 text-[15px] font-medium"
          >
            <Trash2 />
            Delete snapshot draft
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {error?.kind === "session-expired" && <SessionExpiredBanner className="w-full max-w-md" />}
      {error?.kind === "error" && (
        <p role="alert" className="text-xs text-hero-error">
          {errorMessage(error)}
        </p>
      )}

      <DeleteDraftDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        jobId={jobId}
        isDraft={false}
        workDir={workDir}
        remoteJobDir={remoteJobDir}
        files={files}
        preview={preview}
        onError={onDeleteError}
        onSessionExpired={onDeleteSessionExpired}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      />
    </div>
  );
}
