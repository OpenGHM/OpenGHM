"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteSimulationDialog } from "@/components/workspace/delete-simulation-dialog";
import type { Job } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";

/**
 * A list row's one action: delete the simulation, once it is a draft or has
 * ended. A visible, muted icon button that turns red on hover and on focus
 * (never a hidden menu), above the row's stretched link. It opens
 * `DeleteSimulationDialog`, which asks, then refreshes the list. Opening a
 * simulation is the name link's job, and cancelling one is the simulation
 * page's.
 *
 * For an active job the backend would answer 409 `job_active`, so there is no
 * button; an empty placeholder of the same size stays, so the column and the
 * row heights do not change with the status.
 *
 * The dialog is a sibling of the button, not wrapped around it as a Radix
 * trigger, and Radix returns focus only to a Trigger it knows; so the dialog's
 * `onCloseAutoFocus` puts it back on the button.
 */
export function SimulationDeleteButton({
  job,
  name,
  onSessionExpired,
}: {
  job: Job;
  /** The name the row shows; it labels the button for screen readers. */
  name: string;
  /** The session ended during the delete; the list shows the banner. */
  onSessionExpired?: () => void;
}) {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const isDraft = job.status === "DRAFT";
  const deletable = isDraft || isTerminalStatus(job.status);

  if (!deletable) return <span aria-hidden="true" className="inline-block size-10 shrink-0" />;

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        size="icon-lg"
        aria-label={isDraft ? `Delete draft ${name}` : `Delete ${name}`}
        className="relative z-10 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 aria-hidden="true" />
      </Button>
      <DeleteSimulationDialog
        open={open}
        onOpenChange={setOpen}
        jobId={job.id}
        isDraft={isDraft}
        workDir={job.work_dir}
        remoteJobDir={job.remote_job_dir}
        files={job.files}
        onDeleted={() => router.refresh()}
        onSessionExpired={onSessionExpired}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          buttonRef.current?.focus();
        }}
      />
    </>
  );
}
