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
    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-4 text-sm">
      <span className="text-amber-800">
        Please verify your email address to secure your account.
      </span>
      {status === "sent" ? (
        <span className="text-amber-700 shrink-0">{message}</span>
      ) : (
        <button
          onClick={handleResend}
          disabled={status === "sending"}
          className="shrink-0 font-medium text-amber-800 underline hover:text-amber-900 disabled:opacity-50"
        >
          {status === "sending" ? "Sending..." : "Resend verification email"}
        </button>
      )}
    </div>
  );
}
