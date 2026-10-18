"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
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
import { deleteDraft } from "@/lib/jobs/actions";
import type { FilesState } from "@/lib/jobs/types";

/**
 * The confirmation before a delete, controlled so that any control can open
 * it: the detail page's button, a list row's button. The dialog says what goes
 * (ADR 0026): a draft is only a record; a finished job also has two
 * directories on Anvil, listed here by path, and deleting it removes them. If
 * anything fails the snapshot draft still exists and the backend says why.
 *
 * It stays open while the request is in flight. After a delete it goes to the
 * list, unless the caller is already on it and passes `onDeleted`.
 *
 * Offer it only for a DRAFT or a job that has ended; the backend refuses an
 * active one (409 `job_active`).
 */
export function DeleteDraftDialog({
  open,
  onOpenChange,
  jobId,
  isDraft,
  workDir,
  remoteJobDir,
  files,
  preview = false,
  onDeleted,
  onSessionExpired,
  onError,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  isDraft: boolean;
  /** The simulation's output directory on Anvil. */
  workDir: string | null;
  /** slurmly's directory: the batch script and its logs. */
  remoteJobDir: string | null;
  files: FilesState | null;
  /** Fixture data: there is no real job behind `jobId`. */
  preview?: boolean;
  /** Called instead of going to `/workspace` once the snapshot draft is gone,
   *  before `onOpenChange(false)`. */
  onDeleted?: () => void;
  /** The session ended; the caller shows the sign-in banner. */
  onSessionExpired?: () => void;
  /** The delete failed and the snapshot draft still exists; `message` is the
   *  backend's reason, for a caller that shows it beside the control. */
  onError?: (message: string) => void;
  /** Where focus goes when the dialog closes. Radix returns it only to a
   *  Trigger it wraps, which a caller with the dialog as a sibling of its
   *  button, or a menu item that is gone, does not have: the caller calls
   *  `event.preventDefault()` and focuses the control itself. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const paths = [
    workDir && { label: "Output directory", path: workDir, purged: files === "purged" },
    remoteJobDir && { label: "Job directory (script and logs)", path: remoteJobDir, purged: false },
  ].filter((p): p is { label: string; path: string; purged: boolean } => Boolean(p));

  const confirm = async () => {
    if (pending) return;
    if (preview) {
      onOpenChange(false);
      toast.info("Preview data — there is no real snapshot draft to delete.");
      return;
    }
    setPending(true);
    try {
      const result = await deleteDraft(jobId);
      const gone = result.ok || result.reason === "not_found";
      // A caller that tells "deleted" from "closed" hears about the delete first.
      if (gone && onDeleted) onDeleted();
      onOpenChange(false);
      if (gone) {
        toast.success(result.ok ? "Snapshot draft deleted." : "This snapshot draft was already deleted.");
        if (!onDeleted) router.push("/workspace");
      } else if (result.reason === "session_expired") {
        onSessionExpired?.();
        toast.error("Your session has expired. Sign in to delete this snapshot draft.");
      } else {
        // The snapshot draft still exists: say why, and that nothing was lost.
        onError?.(result.message);
        toast.error(result.message);
      }
    } catch (err) {
      // What went wrong is for the console; the person is told what is known.
      console.error("Deleting a snapshot draft failed", err);
      const message = "Could not confirm the delete. The snapshot draft may still exist.";
      onOpenChange(false);
      onError?.(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      // Stay open while the request is in flight: closing would hide the only
      // sign that something is happening.
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <AlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this snapshot draft?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {isDraft ? (
                <p>This snapshot draft is removed.</p>
              ) : (
                <>
                  <p>
                    This removes the snapshot draft and deletes these directories on Anvil:
                  </p>
                  {paths.length > 0 ? (
                    <dl className="space-y-2">
                      {paths.map((p) => (
                        <div key={p.path} className="min-w-0 rounded-lg bg-muted p-2.5">
                          <dt className="text-xs text-muted-foreground">
                            {p.label}
                            {p.purged ? " (Anvil's purge already removed it)" : ""}
                          </dt>
                          <dd className="mt-0.5 break-all font-mono text-xs text-foreground">
                            {p.path}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="rounded-lg bg-muted p-2.5 text-xs">
                      No directories on Anvil are recorded for this snapshot draft.
                    </p>
                  )}
                  <p className="font-medium text-foreground">This can&apos;t be undone.</p>
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className="min-h-10 sm:min-h-9">
            Keep it
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className="min-h-10 bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/30 sm:min-h-9"
            onClick={(event) => {
              // Radix closes the dialog on Action; keep it open until the
              // delete has answered.
              event.preventDefault();
              void confirm();
            }}
          >
            {pending ? (
              <>
                <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
                Deleting…
              </>
            ) : (
              <>
                <Trash2 aria-hidden="true" />
                Delete snapshot draft
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
