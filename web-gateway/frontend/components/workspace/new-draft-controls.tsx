"use client";

import { useId } from "react";
import { Check, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The Save button of the draft wizard, in the header and under Run settings:
 * "Save as draft" for a snapshot draft that is not stored yet (the one way it
 * becomes a draft apart from Submit), "Save draft" for a stored one. Both are
 * the same button. Disabled with a `reason` it says why, in a tooltip on its
 * wrapper (a disabled button shows none of its own) and to a screen reader.
 */
export function SaveDraftButton({
  saving,
  disabled = false,
  reason,
  label = "Save as draft",
  variant = "outline",
  onClick,
  className,
}: {
  saving: boolean;
  /** Off for a reason other than the save itself (nothing to save, a save
   *  already succeeded and the page is opening the draft, a submit is under way). */
  disabled?: boolean;
  /** Why it is off, when `disabled`. */
  reason?: string;
  label?: string;
  /** `on-dark` where the button sits on the navy band. */
  variant?: "outline" | "on-dark";
  onClick: () => void;
  className?: string;
}) {
  const reasonId = useId();
  const explained = disabled && !saving && reason !== undefined;
  return (
    <span title={explained ? reason : undefined} className="inline-flex">
      <Button
        type="button"
        variant={variant}
        disabled={saving || disabled}
        aria-describedby={explained ? reasonId : undefined}
        onClick={onClick}
        className={cn("min-h-10 rounded-xl px-4 text-[13.5px] font-semibold sm:min-h-10", className)}
      >
        {saving ? (
          <>
            <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
            Saving…
          </>
        ) : (
          <>
            <Save aria-hidden="true" />
            {label}
          </>
        )}
      </Button>
      {explained && (
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      )}
    </span>
  );
}

/**
 * What the band says about a snapshot draft that is not saved yet, where a stored
 * draft's `SaveStatus` says where saving stands. Nothing here is saved
 * unless the person asks, so "Saved" is never shown for the edits on screen:
 * only once a draft exists (a submit that asked for one) and holds all of them.
 */
export function NewDraftStatus({ state }: { state: "unsaved" | "saving" | "saved" }) {
  return (
    <div className="text-[12.5px] text-hero-faint">
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
