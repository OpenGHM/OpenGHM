"use client";

import { Suspense } from "react";
import { HardDriveDownload, Hourglass } from "lucide-react";
import { DetailSection } from "@/components/repository/detail-section";
import { OutputCard } from "@/components/output/output-card";
import { OutputSkeleton } from "@/components/output/output-skeleton";
import { useLiveJobContext } from "@/components/workspace/live-job-provider";

/**
 * A run's output on a map, under its status. A run still going has none to read
 * yet; one whose scratch Anvil purged says so without asking; a finished one
 * gets the Output card, which says itself when the run wrote nothing. The
 * status is the live one, so the card appears when the run completes.
 */
export function RunOutput({ jobId, preview = false }: { jobId: string; preview?: boolean }) {
  const { status, view } = useLiveJobContext();
  if (preview) return null;

  if (status === "COMPLETED") {
    if (view.files === "purged") {
      return (
        <DetailSection title="Output">
          <p className="flex items-start gap-2 text-sm text-muted-foreground" role="status">
            <HardDriveDownload className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Anvil deletes a run&apos;s files 30 days after it ran, and this run&apos;s output is gone.
          </p>
        </DetailSection>
      );
    }
    return (
      <Suspense fallback={<OutputSkeleton />}>
        <OutputCard source={{ kind: "job", id: jobId }} />
      </Suspense>
    );
  }
  if (status === "PENDING" || status === "SUBMITTED" || status === "RUNNING" || status === "COMPLETING") {
    return (
      <DetailSection title="Output">
        <p className="flex items-start gap-2 text-sm text-muted-foreground" role="status">
          <Hourglass className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          The output can be viewed here when the run has finished.
        </p>
      </DetailSection>
    );
  }
  return null;
}
