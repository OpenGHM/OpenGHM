"use client";

import { useState } from "react";
import { AlertCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteSimulationDialog } from "@/components/workspace/delete-simulation-dialog";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import type { FilesState } from "@/lib/jobs/types";

/**
 * Delete a simulation: the one delete control on the detail page, for a draft
 * and for a finished job. It opens `DeleteSimulationDialog`, which says what
 * goes; if the delete fails, the reason stays here, under the button.
 *
 * Offer it only for a DRAFT or a job that has ended; the backend refuses an
 * active one (409 `job_active`).
 */
export function DeleteSimulationButton({
  jobId,
  isDraft,
  workDir,
  remoteJobDir,
  files,
  preview = false,
  className,
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
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Button
        type="button"
        variant="outline"
        className="min-h-10 w-full gap-2 border-destructive/30 font-semibold text-destructive hover:bg-destructive/5 hover:text-destructive"
        onClick={() => {
          setError(null);
          setSessionExpired(false);
          setOpen(true);
        }}
      >
        <Trash2 aria-hidden="true" />
        {isDraft ? "Delete draft" : "Delete simulation"}
      </Button>

      <DeleteSimulationDialog
        open={open}
        onOpenChange={setOpen}
        jobId={jobId}
        isDraft={isDraft}
        workDir={workDir}
        remoteJobDir={remoteJobDir}
        files={files}
        preview={preview}
        onSessionExpired={() => setSessionExpired(true)}
        onError={setError}
      />

      {sessionExpired && <SessionExpiredBanner />}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-status-failed/25 bg-status-failed/5 p-3 text-sm text-status-failed"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 break-words">{error}</p>
        </div>
      )}
    </div>
  );
}
