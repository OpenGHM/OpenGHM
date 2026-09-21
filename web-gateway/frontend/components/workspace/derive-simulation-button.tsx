"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FlaskConical, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deriveSimulation } from "@/lib/jobs/actions";

/**
 * "New simulation from this snapshot" (T9) — the only way to start a
 * simulation today (spec.md: starting from scratch needs a model-input
 * catalogue the gateway doesn't have yet). Creates a DRAFT inheriting the
 * snapshot's own configuration and opens it straight in the editor.
 */
export function DeriveSimulationButton({ datasetId }: { datasetId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        const job = await deriveSimulation(datasetId);
        router.push(`/workspace/${job.id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to create simulation";
        setError(msg);
        toast.error(msg);
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        size="lg"
        variant="outline"
        onClick={handleClick}
        disabled={pending}
        className="gap-2 border-[#006994] px-6 text-base font-semibold text-[#006994] hover:bg-[#006994]/5"
      >
        {pending ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <FlaskConical className="size-5" />
        )}
        New simulation from this snapshot
      </Button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
