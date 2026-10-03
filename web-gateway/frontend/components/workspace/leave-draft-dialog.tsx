"use client";

import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Asked when someone with unsaved settings follows a link out of the draft
 * wizard: save them and go on, drop them and go on, or stay. For a simulation
 * that is not stored yet, saving makes it a draft ("Save as draft"); for a
 * stored draft it saves the changes ("Save draft"). A controlled dialog that stays open while the save is in flight, like
 * the app's other confirmations.
 */
export function LeaveDraftDialog({
  stored,
  open,
  saving,
  onSave,
  onDiscard,
  onKeep,
}: {
  /** The draft is stored already: its changes are what is unsaved. */
  stored: boolean;
  open: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onKeep: () => void;
}) {
  const saveLabel = stored ? "Save draft" : "Save as draft";
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onKeep();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
          <AlertDialogDescription>
            {stored
              ? "This draft has changes that are not saved. If you leave now, they are lost. Save the draft to keep them."
              : "This simulation is not saved yet. If you leave now, the settings you chose are lost. Save it as a draft to keep them in My Simulations."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving} className="min-h-10 sm:min-h-9">
            Keep editing
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            onClick={onDiscard}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "min-h-10 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive sm:min-h-9"
            )}
          >
            Discard changes
          </AlertDialogAction>
          <AlertDialogAction
            disabled={saving}
            className="min-h-10 sm:min-h-9"
            onClick={(event) => {
              // Radix closes the dialog on Action; keep it open until the save
              // has answered.
              event.preventDefault();
              onSave();
            }}
          >
            {saving ? (
              <>
                <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              saveLabel
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
