"use client";

import { Check, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Save as draft", the one way a new simulation becomes a stored draft apart
 * from Submit. It sits in the header and under Run settings, so it is a
 * component of its own; both are the same button.
 */
export function SaveDraftButton({
  saving,
  disabled = false,
  onClick,
  className,
}: {
  saving: boolean;
  /** Off for a reason other than the save itself (a save already succeeded and
   *  the page is opening the draft, a submit is under way). */
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={saving || disabled}
      onClick={onClick}
      className={cn("min-h-10 sm:min-h-9", className)}
    >
      {saving ? (
        <>
          <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
          Saving…
        </>
      ) : (
        <>
          <Save aria-hidden="true" />
          Save as draft
        </>
      )}
    </Button>
  );
}

/**
 * What the header says about a simulation that is not saved yet, where a stored
 * draft's `SaveStatus` says how auto-save is going. Nothing here is saved
 * unless the person asks, so "Saved" is never shown for the edits on screen:
 * only once a draft exists (a submit that asked for one) and holds all of them.
 */
export function NewDraftStatus({ state }: { state: "unsaved" | "saving" | "saved" }) {
  return (
    <div className="text-xs text-muted-foreground">
      {state === "saving" ? (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
          Saving…
        </span>
      ) : state === "saved" ? (
        <span className="inline-flex items-center gap-1.5">
          <Check className="size-3.5" aria-hidden="true" />
          Draft saved
        </span>
      ) : (
        "Not saved yet"
      )}
    </div>
  );
}
