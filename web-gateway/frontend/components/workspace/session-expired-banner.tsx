"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signInPath } from "@/lib/auth-redirect";

function subscribeNever() {
  return () => {};
}

/**
 * Inline notice for a 401: the sign-in has expired. Show it wherever a server
 * action returns `{ ok: false, reason: "session_expired" }` (a toast alone
 * disappears before the person can act on it). Sign in returns to the page
 * they are on, query string included.
 */
export function SessionExpiredBanner({ className }: { className?: string }) {
  const pathname = usePathname();
  // The server snapshot knows only the path; in the browser the query string
  // is added, so Sign in returns to the exact URL. Nothing to subscribe to:
  // the snapshot is re-read on every render, and pathname changes re-render.
  const href = useSyncExternalStore(
    subscribeNever,
    () => signInPath(window.location.pathname + window.location.search),
    () => signInPath(pathname)
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col gap-3 rounded-lg border border-warning/25 bg-warning/5 p-3 text-sm text-warning sm:flex-row sm:items-center sm:justify-between ${className ?? ""}`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="space-y-0.5">
          <p className="font-medium">Your session has expired.</p>
          <p className="text-xs text-warning">
            Sign in again to keep going. Simulations that are already in progress
            keep running on Anvil while you are signed out.
          </p>
        </div>
      </div>
      <Button asChild size="sm" variant="outline" className="min-h-10 shrink-0 border-warning/30 bg-background text-warning hover:bg-warning/10 sm:min-h-8">
        <Link href={href}>Sign in</Link>
      </Button>
    </div>
  );
}
