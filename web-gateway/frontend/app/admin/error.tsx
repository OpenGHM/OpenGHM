"use client";

import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminPage } from "@/components/admin/admin-page";

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <AdminPage title="Admin">
      <div
        role="alert"
        className="flex flex-col items-center gap-3 rounded-card border border-destructive/25 bg-destructive/5 p-8 text-center text-destructive"
      >
        <AlertCircle className="size-5" aria-hidden="true" />
        <p className="font-medium">Couldn&apos;t load this page.</p>
        <p className="text-sm">Try again. If it keeps failing, the service may be unavailable.</p>
        <Button variant="outline" onClick={reset} className="min-h-10 sm:min-h-9">
          Try again
        </Button>
      </div>
    </AdminPage>
  );
}
