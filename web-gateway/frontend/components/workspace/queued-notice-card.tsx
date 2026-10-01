"use client";

import { Hourglass } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLiveJobContext } from "@/components/workspace/live-job-provider";
import { TimeStamp } from "@/components/common/time-stamp";
import { HUE } from "@/lib/jobs/status-hue";
import type { JobStatus } from "@/lib/jobs/types";
import { describeQueueReason } from "@/lib/workspace/queue-reason";

/**
 * PENDING/SUBMITTED — accepted, waiting on SLURM. Says why in plain words from
 * the reason SLURM gave (ADR 0027), quotes that reason, and shows how long the
 * job has waited. An estimated start appears only when SLURM gives one.
 */
export function QueuedNoticeCard({ status }: { status: JobStatus }) {
  const { live, submittedAt } = useLiveJobContext();
  const hue = HUE[status === "PENDING" ? "PENDING" : "SUBMITTED"];
  const label = status === "PENDING" ? "Pending" : "Submitted to Anvil";
  const reason = live?.queue_reason ?? null;

  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader
        className={`border-b bg-gradient-to-r ${hue.gradient} to-transparent !py-4 !gap-0 grid-rows-1 items-center`}
      >
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${hue.tile}`}>
            <Hourglass className={`size-4 ${hue.icon}`} aria-hidden="true" />
          </div>
          In the queue
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-5 pb-6">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{label} &mdash; waiting on SLURM</p>
          <p className="text-sm text-muted-foreground">{describeQueueReason(reason)}</p>
          {live && (
            <p className="font-mono text-xs text-muted-foreground">
              SLURM: {reason ?? "no reason given"}
            </p>
          )}
        </div>

        {(submittedAt || live?.estimated_start) && (
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-1">
            {submittedAt && (
              <div className="min-w-0 rounded-lg bg-muted p-3">
                <dt className="text-xs text-muted-foreground">Waiting since</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  <TimeStamp value={submittedAt} format="relative" />
                </dd>
              </div>
            )}
            {live?.estimated_start && (
              <div className="min-w-0 rounded-lg bg-muted p-3">
                <dt className="text-xs text-muted-foreground">SLURM&apos;s estimate</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  <TimeStamp value={live.estimated_start} format="relative" />
                </dd>
              </div>
            )}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
