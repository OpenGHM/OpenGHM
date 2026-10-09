"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthNotice, AuthShell } from "@/components/auth/auth-shell";
import { useTokenRequest } from "@/lib/use-token-request";

function ConfirmLinkBody() {
  const searchParams = useSearchParams();
  const status = useTokenRequest(
    searchParams.get("token"),
    "/api/public-auth/confirm-link",
  );

  if (status === "pending") {
    return <p className="text-sm text-muted-foreground">Confirming the link…</p>;
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
      description="OpenGHM Gateway account linking"
    >
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <ConfirmLinkBody />
      </Suspense>
    </AuthShell>
  );
}
