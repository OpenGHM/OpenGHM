"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  Clock,
  Send,
  Play,
  CheckCircle2,
  XCircle,
  Ban,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { useJobStatus } from "@/lib/jobs/use-job-status";
import { cancelJob } from "@/lib/jobs/actions";
import type { JobStatus, JobStatusResponse } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";

interface Props {
  jobId: string;
  initialStatus: JobStatus;
  initialData?: Partial<JobStatusResponse>;
}

function TimelineRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-muted-foreground">{icon}</span>
      <span className="w-24 text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">
        {new Date(value).toLocaleString()}
      </span>
    </div>
  );
}

export function JobStatusPanel({ jobId, initialStatus, initialData }: Props) {
  const {
    status,
    slurmJobId,
    submittedAt,
    startedAt,
    completedAt,
    statusReason,
    isPolling,
    refresh,
  } = useJobStatus(jobId, initialStatus, initialData);

  const [cancelling, startCancel] = useTransition();

  const handleCancel = () => {
    startCancel(async () => {
      try {
        await cancelJob(jobId);
        toast.success("Job cancelled.");
        refresh();
      } catch {
        toast.error("Failed to cancel job.");
      }
    });
  };

  const cancellable =
    !isTerminalStatus(status) && status !== "COMPLETING" && !cancelling;

  return (
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-r from-[#006994]/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <div className="flex size-8 items-center justify-center rounded-lg bg-[#006994]/10">
            <Play className="size-4 text-[#006994]" />
          </div>
          Job Status
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5 pt-5 pb-6">
        {/* Status badge + Slurm ID */}
        <div className="flex items-center justify-between">
          <JobStatusBadge status={status} />
          {slurmJobId && (
            <span className="text-xs text-muted-foreground">
              Slurm #{slurmJobId}
            </span>
          )}
        </div>

        {/* Timeline */}
        <div className="space-y-2">
          <TimelineRow
            icon={<Clock className="size-3.5" />}
            label="Submitted"
            value={submittedAt}
          />
          <TimelineRow
            icon={<Send className="size-3.5" />}
            label="Started"
            value={startedAt}
          />
          <TimelineRow
            icon={<CheckCircle2 className="size-3.5" />}
            label="Completed"
            value={completedAt}
          />
        </div>

        {/* Status reason (errors) */}
        {statusReason && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <div className="flex items-start gap-2">
              <XCircle className="mt-0.5 size-4 shrink-0" />
              <span>{statusReason}</span>
            </div>
          </div>
        )}

        {/* Polling indicator */}
        {isPolling && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Checking status...
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {cancellable && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Ban className="mr-1.5 size-4" />
              )}
              Cancel Job
            </Button>
          )}
          {!isTerminalStatus(status) && (
            <Button variant="ghost" size="sm" onClick={refresh}>
              <RefreshCw className="mr-1.5 size-4" />
              Refresh
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
