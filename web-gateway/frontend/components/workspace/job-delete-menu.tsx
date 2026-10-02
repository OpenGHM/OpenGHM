"use client";

import { useRef, useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HERO_BUTTON } from "@/components/workspace/hero-button";
import { DeleteSimulationDialog } from "@/components/workspace/delete-simulation-dialog";
import type { FilesState } from "@/lib/jobs/types";

/**
 * The hero's "More actions" menu, whose one item deletes the simulation (a
 * draft, or a job that has ended; the backend refuses an active one). The item
 * opens `DeleteSimulationDialog`, which says what goes.
 *
 * The menu is non-modal, so it never leaves `pointer-events: none` on the body
 * when the dialog takes over from it, and the dialog hands focus back to the
 * trigger, because the item that opened it no longer exists.
 */
export function JobDeleteMenu({
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
  /** The run's output directory on Anvil. */
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
  /** Called instead of going to `/workspace` once the simulation is gone. */
  onDeleted?: () => void;
  /** The delete failed and the simulation still exists. */
  onError?: (message: string) => void;
  onSessionExpired?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            size="icon"
            aria-label="More actions"
            className={`size-10 shrink-0 ${HERO_BUTTON.secondary}`}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* Open the dialog from state, not from inside the item, so the menu
              has closed by the time the dialog mounts. */}
          <DropdownMenuItem
            variant="destructive"
            className="min-h-10 sm:min-h-8"
            onSelect={() => {
              onOpen?.();
              setOpen(true);
              onOpenChange?.(true);
            }}
          >
            <Trash2 aria-hidden="true" />
            {isDraft ? "Delete draft" : "Delete simulation"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeleteSimulationDialog
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
