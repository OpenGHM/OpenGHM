"use client";

import { useState } from "react";
import { toast } from "sonner";
import { resendVerificationEmail } from "@/lib/auth-actions";

export function EmailVerificationBanner() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [message, setMessage] = useState("");

  async function handleResend() {
    setStatus("sending");
    const result = await resendVerificationEmail();
    setMessage(result.message);
    setStatus("sent");
    if (result.ok) toast.success(result.message);
    else toast.error(result.message);
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-card border border-warning/25 bg-warning/10 px-5 py-4 text-sm shadow-card">
      <span className="text-warning">
        Please verify your email address to secure your account.
      </span>
      {status === "sent" ? (
        <span className="shrink-0 text-warning">{message}</span>
      ) : (
        <button
          onClick={handleResend}
          disabled={status === "sending"}
          className="inline-flex min-h-10 shrink-0 items-center font-medium text-warning underline hover:text-foreground disabled:opacity-50"
        >
          {status === "sending" ? "Sending..." : "Resend verification email"}
        </button>
      )}
    </div>
  );
}
