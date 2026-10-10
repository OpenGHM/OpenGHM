"use client";

import { Suspense } from "react";
import { AuthPending } from "@/components/auth/auth-loading";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthNotice, AuthShell } from "@/components/auth/auth-shell";
import { useTokenRequest } from "@/lib/use-token-request";

function VerifyEmailBody() {
  const searchParams = useSearchParams();
  const status = useTokenRequest(
    searchParams.get("token"),
    "/api/public-auth/verify-email",
  );

  if (status === "pending") {
    return <AuthPending>Verifying your email…</AuthPending>;
  }

  if (status === "success") {
    return (
      <AuthNotice tone="success">
        Your email has been verified.{" "}
        <Link href="/auth/signin" className="font-medium underline">
          Sign in
        </Link>{" "}
        to continue.
      </AuthNotice>
    );
  }

  return (
    <p className="text-sm text-destructive">
      This verification link is invalid or has expired. You can request a
      new one from your{" "}
      <Link href="/dashboard/profile" className="underline">
        profile
      </Link>{" "}
      after signing in.
    </p>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthShell
      eyebrow="Verification"
      title="Email verification"
      description="OpenGHM Gateway account verification"
    >
      <Suspense fallback={<AuthPending>Loading…</AuthPending>}>
        <VerifyEmailBody />
      </Suspense>
    </AuthShell>
  );
}
