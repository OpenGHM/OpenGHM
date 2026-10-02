"use client";

import { useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimeStamp } from "@/components/common/time-stamp";
import { FIELD_LABELS, type DraftField } from "@/lib/workspace/draft-wizard";
import type { SaveState } from "@/lib/workspace/use-draft-autosave";

/** The states in which the draft on screen is not on the server and a person
 *  has something to know or do about it. */
const FAILING: ReadonlySet<SaveState["kind"]> = new Set([
  "retrying",
  "failed",
  "refused",
  "session-expired",
  "conflict",
  "gone",
]);

/** A control the person acts on, in the failure pill. */
function PillButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      className="min-h-10 sm:min-h-7 sm:py-0"
    >
      {children}
    </Button>
  );
}

/**
 * How auto-saving is going, in words, from `useDraftAutosave().state`.
 *
 * The visible text is not a live region: it changes with every keystroke
 * ("Saving…", "Saved") and announcing that would be noise. A separate hidden
 * `role="status"` speaks only when the draft first fails to save and when it is
 * saved again afterwards, once each, whatever the visible text does in between.
 *
 * It is built for the wizard's dark hero: calm states are white text, and a
 * failure is a light pill so that it reads on the navy. `onRetry` is for
 * "Couldn't save" and `onGoToField` for "fix <field>", which is a link to the
 * field that stopped the save.
 */
export function SaveStatus({
  state,
  onRetry,
  onGoToField,
}: {
  state: SaveState;
  onRetry: () => void;
  onGoToField: (field: DraftField) => void;
}) {
  const failing = FAILING.has(state.kind);
  const [wasFailing, setWasFailing] = useState(failing);
  const [announcement, setAnnouncement] = useState("");
  // Derived during render, so the announcement and the text change together.
  if (failing && !wasFailing) {
    setWasFailing(true);
    setAnnouncement("Couldn't save your changes.");
  } else if (!failing && wasFailing && state.kind === "saved") {
    setWasFailing(false);
    setAnnouncement("Your changes are saved.");
  }

  let visible: React.ReactNode;
  switch (state.kind) {
    case "saved":
      visible = (
        <span className="inline-flex items-center gap-1.5">
          <Check className="size-3.5" aria-hidden="true" />
          Saved
          {state.at && <TimeStamp value={state.at} format="relative" className="text-white/60" />}
        </span>
      );
      break;
    case "saving":
      visible = (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
          Saving…
        </span>
      );
      break;
    case "suspended":
      visible = "Auto-save is off";
      break;
    default:
      visible = (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-white p-1.5 pl-2.5 text-xs text-status-failed">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <FailureText state={state} onRetry={onRetry} onGoToField={onGoToField} />
        </span>
      );
  }

  return (
    <div className="text-xs text-white/80">
      <span>{visible}</span>
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}

function FailureText({
  state,
  onRetry,
  onGoToField,
}: {
  state: SaveState;
  onRetry: () => void;
  onGoToField: (field: DraftField) => void;
}) {
  switch (state.kind) {
    case "retrying":
      return <span>Couldn&apos;t save. Retrying…</span>;
    case "failed":
      return (
        <>
          <span>Couldn&apos;t save</span>
          <PillButton onClick={onRetry}>Retry</PillButton>
        </>
      );
    case "refused": {
      const [first, ...rest] = state.fields;
      return (
        <>
          <span>Couldn&apos;t save:</span>
          <Button
            type="button"
            variant="link"
            title={state.message}
            onClick={() => onGoToField(first)}
            className="h-auto min-h-10 p-0 text-xs text-status-failed underline sm:min-h-7"
          >
            fix {FIELD_LABELS[first]}
          </Button>
          {rest.length > 0 && <span>and {rest.length} more</span>}
        </>
      );
    }
    case "session-expired":
      return <span>Couldn&apos;t save: sign in again</span>;
    case "conflict":
    case "gone":
      return <span>Not saved</span>;
    default:
      return null;
  }
}
