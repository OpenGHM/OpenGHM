"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** How long "Copied" (or the failure) stays on the button, for every copy button of the site. */
export const COPY_FEEDBACK_MS = 2000;

/** What a button says when the browser refused the clipboard (an insecure page, a denied permission). */
export const COPY_FAILED = "Copy failed — select the text";

export type CopyState = "idle" | "copied" | "failed";

/**
 * The state of a copy button: `copy(text)` puts the text on the clipboard and
 * moves to `copied`, or to `failed` when the browser says no, then back to
 * `idle` after `COPY_FEEDBACK_MS`.
 */
export function useCopy(): { state: CopyState; copy: (text: string) => Promise<void> } {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async (text: string) => {
    let next: CopyState = "copied";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      next = "failed";
    }
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), COPY_FEEDBACK_MS);
  }, []);

  return { state, copy };
}

/**
 * A button that copies `text` and says so: "Copied" for a moment, or that the
 * copy failed, in the label and in a polite live region for a screen reader.
 * The look is the caller's (`className`); this is the behaviour every copy
 * button shares. `label` names what is copied ("Copy <label>" is the button's
 * accessible name) and is required for an icon-only button, which also takes
 * `idleTitle` as its tooltip.
 */
export function CopyButton({
  text,
  label,
  idle = "Copy",
  iconOnly = false,
  idleTitle,
  className,
  copiedIconClassName,
  iconClassName = "size-3.5",
}: {
  text: string;
  label?: string;
  /** The words on the button before a click. */
  idle?: string;
  iconOnly?: boolean;
  idleTitle?: string;
  className?: string;
  /** Extra classes for the check mark that replaces the icon after a copy. */
  copiedIconClassName?: string;
  iconClassName?: string;
}) {
  const { state, copy } = useCopy();
  const words = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : idle;
  const title = state === "copied" ? "Copied" : state === "failed" ? COPY_FAILED : iconOnly ? idleTitle : undefined;

  return (
    <>
      <button
        type="button"
        onClick={() => void copy(text)}
        aria-label={label ? `Copy ${label}` : undefined}
        title={title}
        className={className}
      >
        {state === "copied" ? (
          <Check aria-hidden="true" className={cn(iconClassName, copiedIconClassName)} />
        ) : (
          <Copy aria-hidden="true" className={iconClassName} />
        )}
        {!iconOnly && words}
      </button>
      <span aria-live="polite" data-copy-status="" className="sr-only">
        {state === "copied" ? `Copied ${label ?? ""}`.trim() : state === "failed" ? COPY_FAILED : ""}
      </span>
    </>
  );
}
