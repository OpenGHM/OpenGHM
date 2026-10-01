"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FlaskConical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HERO_BUTTON, HeroError } from "@/components/workspace/hero-button";
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
  label = "New simulation from this model snapshot",
  fullWidth = false,
  tone = "default",
}: {
  datasetId: string;
  label?: string;
  /** Fill the card it sits in (the detail page's cards). */
  fullWidth?: boolean;
  /** `hero`: the page header's white button, full width on a phone. */
  tone?: "default" | "hero";
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

  const hero = tone === "hero";

  return (
    <div
      className={`flex max-w-full flex-col gap-1.5 ${
        hero ? "items-stretch sm:items-end" : fullWidth ? "items-stretch" : "items-end"
      }`}
    >
      <Button
        size={hero ? "default" : "lg"}
        variant={hero ? "default" : "outline"}
        onClick={handleClick}
        disabled={pending}
        className={
          hero
            ? `min-h-10 gap-2 px-4 font-semibold ${HERO_BUTTON.primary}`
            : "h-auto min-h-10 gap-2 whitespace-normal border-primary px-6 text-left text-base font-semibold text-primary hover:bg-primary/5"
        }
      >
        {pending ? (
          <Loader2 className={hero ? "motion-safe:animate-spin" : "size-5 motion-safe:animate-spin"} />
        ) : (
          <FlaskConical className={hero ? undefined : "size-5"} />
        )}
        {label}
      </Button>
      {sessionExpired && <SessionExpiredBanner className="w-full max-w-md" />}
      {error &&
        (hero ? (
          <HeroError>{error}</HeroError>
        ) : (
          <p role="alert" className="text-xs text-status-failed">
            {error}
          </p>
        ))}
    </div>
  );
}
