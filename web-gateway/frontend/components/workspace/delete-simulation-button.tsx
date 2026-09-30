"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, Loader2, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { deleteSimulation } from "@/lib/jobs/actions";
import type { FilesState } from "@/lib/jobs/types";

/**
 * Delete a simulation: the one delete control, for a draft and for a finished
 * job. The dialog says what goes (ADR 0026): a draft is only a record; a
 * finished job also has two directories on Anvil, listed here by path, and
 * deleting it removes them. If anything fails the simulation still exists and
 * the backend says why.
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const paths = [
    workDir && { label: "Output directory", path: workDir, purged: files === "purged" },
    remoteJobDir && { label: "Job directory (script and logs)", path: remoteJobDir, purged: false },
  ].filter((p): p is { label: string; path: string; purged: boolean } => Boolean(p));

  const confirm = async () => {
    if (pending) return;
    if (preview) {
      setOpen(false);
      toast.info("Preview data — there is no real simulation to delete.");
      return;
    }
    setPending(true);
    setError(null);
    setSessionExpired(false);
    try {
      const result = await deleteSimulation(jobId);
      if (result.ok || result.reason === "not_found") {
        setOpen(false);
        toast.success(
          result.ok ? (isDraft ? "Draft deleted." : "Simulation deleted.") : "This simulation was already deleted."
        );
        router.push("/workspace");
        return;
      }
      setOpen(false);
      if (result.reason === "session_expired") {
        setSessionExpired(true);
        toast.error("Your session has expired. Sign in to delete this simulation.");
      } else {
        // The simulation still exists: say why, and that nothing was lost.
        setError(result.message);
        toast.error(result.message);
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? `Could not confirm the delete: ${err.message}. The simulation may still exist.`
          : "Could not confirm the delete. The simulation may still exist.";
      setOpen(false);
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <AlertDialog
        open={open}
        // Stay open while the request is in flight: closing would hide the
        // only sign that something is happening.
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
      >
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="min-h-10 w-full gap-2 border-destructive/30 font-semibold text-destructive hover:bg-destructive/5 hover:text-destructive"
          >
            <Trash2 aria-hidden="true" />
            {isDraft ? "Delete draft" : "Delete simulation"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isDraft ? "Delete this draft?" : "Delete this simulation?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {isDraft ? (
                  <p>This draft is removed.</p>
                ) : (
                  <>
                    <p>
                      This removes the simulation and deletes these directories on Anvil:
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
                        No directories on Anvil are recorded for this simulation.
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
                // Radix closes the dialog on Action; keep it open until
                // the delete has answered.
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
                  {isDraft ? "Delete draft" : "Delete simulation"}
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
