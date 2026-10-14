"use client";

import { Suspense } from "react";
import { AuthPending } from "@/components/auth/auth-loading";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuthNotice, AuthShell } from "@/components/auth/auth-shell";
import { useTokenRequest } from "@/lib/use-token-request";

function VerifyEmailBody() {
  const searchParams = useSearchParams();
  const { status, submit } = useTokenRequest(
    searchParams.get("token"),
    "/api/public-auth/verify-email",
  );

  if (status === "ready") {
    return (
      <Button type="button" size="xl" className="w-full" onClick={submit}>
        Verify my email
      </Button>
    );
  }

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
      description="Confirm that this email address is yours to finish setting up your OpenGHM Gateway account."
    >
      <Suspense fallback={<AuthPending>Loading…</AuthPending>}>
        <VerifyEmailBody />
      </Suspense>
    </AuthShell>
  );
}
