"use client";

import { useEffect, useId } from "react";
import { toast } from "sonner";
import { Loader2, RotateCcw, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { useCreateDraft } from "@/lib/jobs/use-create-draft";
import { cn } from "@/lib/utils";

export type CreateError = NonNullable<ReturnType<typeof useCreateDraft>["error"]>;

/** What a failed copy says, for the button's own line, its toast and the
 *  page's actions menu (`JobActionsMenu`). */
export function errorMessage(error: CreateError): string {
  if (error.kind === "session-expired") return "Your session has expired.";
  if (error.code === "snapshot_not_found") {
    return "This snapshot draft's model snapshot is no longer in the repository, so it can't be copied.";
  }
  return error.message;
}

/**
 * A new draft that copies this snapshot draft's run settings
 * (`POST /jobs/{id}/duplicate`), opened at the draft wizard's second step.
 * Unlike `DeriveDraftButton`, which starts over from the snapshot's
 * defaults, nothing the owner chose is lost. The snapshot draft itself is not
 * touched.
 *
 * It is the one copy action of the snapshot draft page, in two places so that it is
 * on the page once: "Try again with these settings" in the status summary of a
 * failed or cancelled job, "Duplicate" in the header of a completed one
 * (`summaryOffersCopy`).
 *
 * One request at a time, and the button stays off after a success, through the
 * navigation (`useCreateDraft`). A failure is shown under the button and as a
 * toast; a snapshot that has left the repository says so, because that cannot
 * be fixed by trying again.
 */
export function DuplicateDraftButton({
  jobId,
  label = "Try again with these settings",
  variant = "default",
  Icon = RotateCcw,
  className,
}: {
  jobId: string;
  label?: string;
  /** `default`: the page's one emphasised action (a failed simulation). `outline`: a quieter one. */
  variant?: "default" | "outline";
  Icon?: LucideIcon;
  className?: string;
}) {
  const { pending, error, duplicateFrom } = useCreateDraft();
  const noteId = useId();

  const message = error === null ? null : errorMessage(error);
  // `error` is a new object for every failure, so a second identical one toasts again.
  useEffect(() => {
    if (error) toast.error(errorMessage(error));
  }, [error]);

  return (
    <div className="flex max-w-full shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
      <Button
        type="button"
        variant={variant}
        disabled={pending}
        aria-describedby={noteId}
        onClick={() => void duplicateFrom(jobId)}
        className={cn("min-h-10 gap-2 font-semibold", className)}
      >
        {pending ? (
          <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
        ) : (
          <Icon aria-hidden="true" />
        )}
        {label}
      </Button>
      <p id={noteId} className="sr-only">
        Copies this snapshot draft&apos;s run settings into a new draft.
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
