"use client";

import { useEffect, useId } from "react";
import { toast } from "sonner";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CARD_BUTTON } from "@/components/workspace/derive-simulation-button";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { useCreateDraft } from "@/lib/jobs/use-create-draft";

type CreateError = NonNullable<ReturnType<typeof useCreateDraft>["error"]>;

function errorMessage(error: CreateError): string {
  if (error.kind === "session-expired") return "Your session has expired.";
  if (error.code === "snapshot_not_found") {
    return "This simulation's model snapshot is no longer in the repository, so it can't be copied.";
  }
  return error.message;
}

/**
 * "Try again with these settings": a new draft that copies this simulation's
 * run settings (`POST /jobs/{id}/duplicate`), opened at the draft wizard's
 * second step. Unlike `DeriveSimulationButton`, which starts over from the
 * snapshot's defaults, nothing the owner chose is lost. The simulation itself
 * is not touched.
 *
 * One request at a time, and the button stays off after a success, through the
 * navigation (`useCreateDraft`). A failure is shown under the button and as a
 * toast; a snapshot that has left the repository says so, because that cannot
 * be fixed by trying again.
 */
export function DuplicateSimulationButton({
  jobId,
  label = "Try again with these settings",
}: {
  jobId: string;
  label?: string;
}) {
  const { pending, error, duplicateFrom } = useCreateDraft();
  const noteId = useId();

  const message = error === null ? null : errorMessage(error);
  // `error` is a new object for every failure, so a second identical one toasts again.
  useEffect(() => {
    if (error) toast.error(errorMessage(error));
  }, [error]);

  return (
    <div className="flex max-w-full flex-col items-stretch gap-1.5">
      <Button
        type="button"
        size="lg"
        variant="outline"
        disabled={pending}
        aria-describedby={noteId}
        onClick={() => void duplicateFrom(jobId)}
        className={CARD_BUTTON}
      >
        {pending ? (
          <Loader2 className="size-5 motion-safe:animate-spin" aria-hidden="true" />
        ) : (
          <RotateCcw className="size-5" aria-hidden="true" />
        )}
        {label}
      </Button>
      <p id={noteId} className="text-xs text-muted-foreground">
        Copies this simulation&apos;s run settings into a new draft.
      </p>
      {error?.kind === "session-expired" && <SessionExpiredBanner className="w-full max-w-md" />}
      {error?.kind === "error" && (
        <p role="alert" className="text-xs text-status-failed">
          {message}
        </p>
      )}
    </div>
  );
}
