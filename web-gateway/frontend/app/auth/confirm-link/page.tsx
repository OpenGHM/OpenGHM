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
      <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-3">
        Your sign-in methods have been linked.{" "}
        <Link href="/auth/signin" className="font-medium underline">
          Sign in
        </Link>{" "}
        to continue.
      </p>
    );
  }

  return (
    <p className="text-sm text-red-600">
      This confirmation link is invalid or has expired. Try registering or
      signing in again to send a new one.
    </p>
  );
}

export default function ConfirmLinkPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Link sign-in methods</CardTitle>
          <CardDescription>OpenGHM Gateway account linking</CardDescription>
        </CardHeader>
        <Suspense fallback={<CardContent><p className="text-sm text-muted-foreground">Loading…</p></CardContent>}>
          <CardContent>
            <ConfirmLinkBody />
          </CardContent>
        </Suspense>
      </Card>
    </main>
  );
}
