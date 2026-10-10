"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Header } from "@/components/landing/header";
import { Button } from "@/components/ui/button";

/**
 * The error boundary of every Community page. The list page answers a backend
 * that is down with its own inline box, so this is for a detail page whose
 * fetch failed, or anything unexpected.
 */
export default function CommunityError({
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
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-7">
        <div
          role="alert"
          className="space-y-3 rounded-card border border-destructive/25 bg-card p-8 text-center shadow-card"
        >
          <p className="font-medium text-status-failed">This Community page could not be loaded.</p>
          <p className="text-sm text-destructive">
            The gateway could not reach its content service. Try again in a moment.
          </p>
          {error.digest && <p className="text-xs text-status-failed">Reference: {error.digest}</p>}
          <div className="flex flex-col justify-center gap-2 pt-2 sm:flex-row">
            <Button variant="outline" className="min-h-10" onClick={reset}>
              Try again
            </Button>
            <Button asChild variant="ghost" className="min-h-10">
              <Link href="/community">Back to Community</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
