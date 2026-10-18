"use client";

import { useState } from "react";
import { MailWarning } from "lucide-react";
import { toast } from "sonner";
import { resendVerificationEmail } from "@/lib/auth-actions";

export function EmailVerificationBanner() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleResend() {
    setStatus("sending");
    const result = await resendVerificationEmail();
    setMessage(result.message);
    // A failed resend keeps the button, so the visitor can try again.
    setStatus(result.ok ? "sent" : "error");
    if (result.ok) toast.success(result.message);
    else toast.error(result.message);
  }

  // A white card like the ones beside it: PageBody pulls it up into the navy
  // band, where a tinted, see-through box turned dark and unreadable.
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border-l-4 border-warning bg-card px-5 py-4 text-sm shadow-raised">
      <span className="flex items-center gap-2.5 text-foreground">
        <MailWarning aria-hidden="true" className="size-4 shrink-0 text-warning" />
        Please verify your email address to secure your account.
      </span>
      {status === "sent" ? (
        <span className="shrink-0 text-muted-foreground">{message}</span>
      ) : (
        <span className="flex flex-wrap items-center gap-x-3">
          {status === "error" && (
            <span role="alert" className="text-destructive">
              {message}
            </span>
          )}
          <button
            onClick={handleResend}
            disabled={status === "sending"}
            className="inline-flex min-h-10 shrink-0 items-center font-medium text-warning underline hover:text-foreground disabled:opacity-50"
          >
            {status === "sending" ? "Sending..." : status === "error" ? "Try again" : "Resend verification email"}
          </button>
        </span>
      )}
    </div>
  );
}
