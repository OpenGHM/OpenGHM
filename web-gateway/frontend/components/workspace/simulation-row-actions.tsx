"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, MoreHorizontal, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CancelJobDialog } from "@/components/workspace/cancel-job-dialog";
import { DeleteSimulationDialog } from "@/components/workspace/delete-simulation-dialog";
import type { Job } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";

type Open = "cancel" | "delete" | null;

/**
 * What a list row can do: open it, cancel it while it is active, delete it
 * once it is a draft or has ended. The menu only offers what the backend
 * would accept; Cancel and Delete ask in their dialogs, then refresh the list.
 *
 * The dialogs are siblings of the menu, opened from an item's `onSelect`
 * through state, so the menu has closed by the time a dialog opens. Opened
 * from inside the menu, Radix leaves `pointer-events: none` on the body.
 */
export function SimulationRowActions({
  job,
  name,
  onSessionExpired,
}: {
  job: Job;
  /** The name the row shows; it labels the button for screen readers. */
  name: string;
  /** The session ended during Cancel or Delete; the list shows the banner. */
  onSessionExpired?: () => void;
}) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<Open>(null);

  const isDraft = job.status === "DRAFT";
  // The detail page's rule: not while COMPLETING (nothing left to stop), and
  // not again once a cancel is waiting on SLURM.
  const cancellable =
    !isTerminalStatus(job.status) &&
    !isDraft &&
    job.status !== "COMPLETING" &&
    !job.cancel_requested_at;
  // Never an active job: the backend answers 409 `job_active`.
  const deletable = isDraft || isTerminalStatus(job.status);

  const setOpen = (which: Exclude<Open, null>) => (open: boolean) => {
    setDialog(open ? which : null);
    // The dialog would return focus to the menu item it was opened from,
    // which is gone; put it back on the button, after the dialog has let go.
    if (!open) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <>
      {/* Not modal: the menu then leaves the body's pointer events alone. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="ghost"
            size="icon-lg"
            aria-label={`Actions for ${name}`}
            className="text-muted-foreground"
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem asChild className="min-h-10 sm:min-h-8">
            <Link href={`/workspace/${job.id}`}>
              <FolderOpen aria-hidden="true" />
              Open
            </Link>
          </DropdownMenuItem>
          {cancellable && (
            <DropdownMenuItem
              className="min-h-10 sm:min-h-8"
              onSelect={() => setDialog("cancel")}
            >
              <XCircle aria-hidden="true" />
              Cancel simulation
            </DropdownMenuItem>
          )}
          {deletable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                className="min-h-10 sm:min-h-8"
                onSelect={() => setDialog("delete")}
              >
                <Trash2 aria-hidden="true" />
                {isDraft ? "Delete draft" : "Delete simulation"}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {cancellable && (
        <CancelJobDialog
          open={dialog === "cancel"}
          onOpenChange={setOpen("cancel")}
          jobId={job.id}
          onCancelled={() => router.refresh()}
          // A 409: it ended while the list was open. Look again.
          onConflict={() => router.refresh()}
          onSessionExpired={onSessionExpired}
        />
      )}
      {deletable && (
        <DeleteSimulationDialog
          open={dialog === "delete"}
          onOpenChange={setOpen("delete")}
          jobId={job.id}
          isDraft={isDraft}
          workDir={job.work_dir}
          remoteJobDir={job.remote_job_dir}
          files={job.files}
          onDeleted={() => router.refresh()}
          onSessionExpired={onSessionExpired}
        />
      )}
    </>
  );
}
