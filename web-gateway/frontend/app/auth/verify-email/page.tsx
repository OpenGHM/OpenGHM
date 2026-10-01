"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTokenRequest } from "@/lib/use-token-request";

function VerifyEmailBody() {
  const searchParams = useSearchParams();
  const status = useTokenRequest(
    searchParams.get("token"),
    "/api/public-auth/verify-email",
  );

  if (status === "pending") {
    return <p className="text-sm text-muted-foreground">Verifying your email…</p>;
  }

  if (status === "success") {
    return (
      <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-3">
        Your email has been verified.{" "}
        <Link href="/auth/signin" className="font-medium underline">
          Sign in
        </Link>{" "}
        to continue.
      </p>
    );
  }

  return (
    <p className="text-sm text-red-600">
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
    <main className="min-h-screen flex items-center justify-center bg-slate-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Email verification</CardTitle>
          <CardDescription>OpenGHM Gateway account verification</CardDescription>
        </CardHeader>
        <Suspense fallback={<CardContent><p className="text-sm text-muted-foreground">Loading…</p></CardContent>}>
          <CardContent>
            <VerifyEmailBody />
          </CardContent>
        </Suspense>
      </Card>
    </main>
  );
}
