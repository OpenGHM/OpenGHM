"use client";

import { Suspense } from "react";
import { AuthPending } from "@/components/auth/auth-loading";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuthNotice, AuthShell } from "@/components/auth/auth-shell";
import { useTokenRequest } from "@/lib/use-token-request";

function ConfirmLinkBody() {
  const searchParams = useSearchParams();
  const { status, submit } = useTokenRequest(
    searchParams.get("token"),
    "/api/public-auth/confirm-link",
  );

  if (status === "ready") {
    return (
      <div className="space-y-4">
        <p className="text-sm leading-[1.55] text-muted-foreground">
          Confirm only if you started this yourself. If you did not, close this
          page: nothing changes on your account.
        </p>
        <Button type="button" size="xl" className="w-full" onClick={submit}>
          Confirm the new sign-in method
        </Button>
      </div>
    );
  }

  if (status === "pending") {
    return <AuthPending>Confirming the link…</AuthPending>;
  }

  if (status === "success") {
    return (
      <AuthNotice tone="success">
        Your sign-in methods have been linked.{" "}
        <Link href="/auth/signin" className="font-medium underline">
          Sign in
        </Link>{" "}
        to continue.
      </AuthNotice>
    );
  }

  return (
    <p className="text-sm text-destructive">
      This confirmation link is invalid or has expired. Try registering or
      signing in again to send a new one.
    </p>
  );
}

export default function ConfirmLinkPage() {
  return (
    <AuthShell
      eyebrow="Account linking"
      title="Link sign-in methods"
      description="Someone asked to add a new way of signing in to the OpenGHM Gateway account for this email address."
    >
      <Suspense fallback={<AuthPending>Loading…</AuthPending>}>
        <ConfirmLinkBody />
      </Suspense>
    </AuthShell>
  );
}
