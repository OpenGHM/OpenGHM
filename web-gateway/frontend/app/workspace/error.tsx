"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Header } from "@/components/landing/header";
import { Button } from "@/components/ui/button";

/**
 * Route error boundary for every Workspace page. Without it a failed fetch
 * falls through to Next's bare default error. A 401 is handled before it gets
 * here (pages redirect to sign in, actions return `session_expired`), so this
 * is for what is left: the backend being down, or an unexpected failure.
 */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-10">
        <div
          role="alert"
          className="space-y-3 rounded-lg border border-dashed border-destructive/25 bg-destructive/5 p-8 text-center"
        >
          <p className="font-medium text-status-failed">Something went wrong loading this page.</p>
          <p className="text-sm text-destructive">
            A simulation that is already running is not affected. Try again, or go
            back to your list.
          </p>
          {error.digest && <p className="text-xs text-status-failed">Reference: {error.digest}</p>}
          <div className="flex flex-col justify-center gap-2 pt-2 sm:flex-row">
            <Button variant="outline" className="min-h-10" onClick={reset}>
              Try again
            </Button>
            <Button asChild variant="ghost" className="min-h-10">
              <Link href="/workspace">My Simulations</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
