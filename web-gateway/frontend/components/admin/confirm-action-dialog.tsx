"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
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

export type ConfirmResult = { ok: true } | { ok: false; message?: string };

/**
 * The confirmation every costly admin action goes through. Controlled, so a
 * select or a button can open it; pass `trigger` to have the dialog render
 * the button that opens it. It owns the request and its toasts, and says
 * nothing it was not told.
 *
 * It stays open while the request is in flight: closing would hide the only
 * sign that something is happening. If the request fails it stays open with
 * the reason in the dialog as well as in a toast, so the admin can retry or
 * back out. Closing by any route (Cancel, Escape, outside) calls
 * `onOpenChange(false)`, which is where a caller puts its revert.
 */
export function ConfirmActionDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  detail,
  confirmLabel,
  pendingLabel = "Working…",
  cancelLabel = "Cancel",
  successMessage,
  failureMessage,
  destructive = true,
  onConfirm,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The button that opens the dialog, when the caller has no state of its own. */
  trigger?: React.ReactNode;
  title: string;
  /** What will happen, in one or two plain sentences. */
  description: string;
  /** Something to show under the description, such as the device's name. */
  detail?: string;
  confirmLabel: string;
  pendingLabel?: string;
  cancelLabel?: string;
  successMessage: string;
  /** Shown when the request fails without a reason of its own. */
  failureMessage: string;
  destructive?: boolean;
  onConfirm: () => Promise<ConfirmResult>;
  /** The request succeeded; the dialog has closed. */
  onDone?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The control that opened the dialog. Opened from a select or a switch
  // rather than a Trigger, Radix would leave focus on the body when it closes.
  const opener = useRef<HTMLElement | null>(null);

  const run = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    let message: string | null = null;
    try {
      const result = await onConfirm();
      if (!result.ok) message = result.message || failureMessage;
    } catch {
      message = failureMessage;
    }
    setPending(false);
    if (message) {
      setError(message);
      toast.error(message);
      return;
    }
    onOpenChange(false);
    toast.success(successMessage);
    onDone?.();
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) setError(null);
        onOpenChange(next);
      }}
    >
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent
        onOpenAutoFocus={() => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          if (opener.current?.isConnected) {
            event.preventDefault();
            opener.current.focus();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          {detail && (
            <p className="rounded-md bg-muted px-3 py-2 text-left text-xs text-foreground [overflow-wrap:anywhere]">
              {detail}
            </p>
          )}
          {error && (
            <p role="alert" className="text-left text-sm text-destructive">
              {error}
            </p>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className="min-h-10 sm:min-h-9">
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className={
              destructive
                ? "min-h-10 bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/30 sm:min-h-9"
                : "min-h-10 sm:min-h-9"
            }
            onClick={(event) => {
              // Radix closes the dialog on Action; keep it open until the
              // request has answered.
              event.preventDefault();
              void run();
            }}
          >
            {pending ? (
              <>
                <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />
                {pendingLabel}
              </>
            ) : (
              confirmLabel
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
