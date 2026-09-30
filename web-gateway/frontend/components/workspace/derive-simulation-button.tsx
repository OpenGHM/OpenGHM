"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FlaskConical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import { deriveSimulation } from "@/lib/jobs/actions";

/**
 * "New simulation from this snapshot" (T9) — the only way to start a
 * simulation today (spec.md: starting from scratch needs a model-input
 * catalogue the gateway doesn't have yet). Creates a DRAFT inheriting the
 * snapshot's own configuration and opens it straight in the editor.
 */
export function DeriveSimulationButton({
  datasetId,
  label = "New simulation from this snapshot",
  fullWidth = false,
}: {
  datasetId: string;
  label?: string;
  /** Fill the card it sits in (the detail page's cards). */
  fullWidth?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  const handleClick = () => {
    setError(null);
    setSessionExpired(false);
    startTransition(async () => {
      try {
        const result = await deriveSimulation(datasetId);
        if (!result.ok) {
          if (result.reason === "session_expired") {
            setSessionExpired(true);
            toast.error("Your session has expired.");
          } else {
            const msg =
              result.reason === "error" ? result.message : "Failed to create simulation";
            setError(msg);
            toast.error(msg);
          }
          return;
        }
        router.push(`/workspace/${result.data.id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to create simulation";
        setError(msg);
        toast.error(msg);
      }
    });
  };

  return (
    <div className={`flex flex-col gap-1.5 ${fullWidth ? "items-stretch" : "items-end"}`}>
      <Button
        size="lg"
        variant="outline"
        onClick={handleClick}
        disabled={pending}
        className="min-h-10 gap-2 border-primary px-6 text-base font-semibold text-primary hover:bg-primary/5"
      >
        {pending ? (
          <Loader2 className="size-5 motion-safe:animate-spin" />
        ) : (
          <FlaskConical className="size-5" />
        )}
        {label}
      </Button>
      {sessionExpired && <SessionExpiredBanner className="w-full max-w-md" />}
      {error && <p role="alert" className="text-xs text-status-failed">{error}</p>}
    </div>
  );
}
