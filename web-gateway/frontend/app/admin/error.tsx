"use client";

import { Button } from "@/components/ui/button";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="rounded-lg border border-dashed border-red-200 bg-red-50 p-8 text-center space-y-3">
        <p className="font-medium text-red-800">Something went wrong loading this page.</p>
        <p className="text-sm text-red-600">{error.message}</p>
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
