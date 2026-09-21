"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, AlertCircle, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitJob } from "@/lib/jobs/actions";
import type { Dataset } from "@/lib/repository/types";

interface ReviewSubmitClientProps {
  snapshot: Dataset;
}

export function ReviewSubmitClient({ snapshot }: ReviewSubmitClientProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const variables = snapshot.simulation.outputVariables.map((v) => v.name);

      const result = await submitJob({
        dataset_id: snapshot.id,
        parameters: {
          temporal_range_start: snapshot.simulation.temporalCoverage.start,
          temporal_range_end: snapshot.simulation.temporalCoverage.end,
          spatial_domain: null,
          variables,
          custom_params: null,
        },
      });

      toast.success("Simulation submitted.");
      router.push(`/simulations/${result.job_id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to submit simulation";
      setError(msg);
      toast.error(msg);
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          This will queue a job on Anvil HPC using the default configuration.
        </p>
        <Button
          onClick={handleSubmit}
          disabled={submitting}
          className="bg-[#006994] hover:bg-[#005a7a] font-semibold"
        >
          {submitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Submitting…
            </>
          ) : (
            <>
              <Rocket className="mr-2 size-4" />
              Submit Simulation
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
