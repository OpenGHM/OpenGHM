"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Download, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CopyButton } from "@/components/workspace/copy-button";
import { LogBlock, LogSkeleton } from "@/components/workspace/log-block";
import { useLiveJobContext } from "@/components/workspace/live-job-provider";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import type { LogStream } from "@/lib/jobs/types";
import { currentJobNumber, jobCount } from "@/lib/workspace/job-runs";
import { filenameFromDisposition, logDownloadUrl, messageFromErrorBody } from "@/lib/workspace/log-download";
import { buildLogBox, LOG_SOURCES, sourceTitle } from "@/lib/workspace/log-box";
import { rowsToText } from "@/lib/workspace/log-sections";
import { previewStreamState } from "@/lib/workspace/log-stream";
import { useJobLogs } from "@/lib/workspace/use-job-logs";

/**
 * A job's logs (ADR 0027) in one box: the three files on Anvil laid end to end
 * in the order they happen, with a plain separator line at the start of each
 * (`buildLogBox`). It reads them as they grow, follows the end, and downloads
 * a whole file through the route handler. `previewLogs` is fixture text for
 * the dev preview, shown without reading anything.
 *
 * A simulation run by several jobs (ADR 0037) has a job output and messages
 * for each job, and a picker chooses whose are shown and downloaded: the
 * current job's until a person picks another. WBM's log is one file across
 * jobs, so the picker does not touch it.
 */
export function LogViewer({ previewLogs }: { previewLogs?: Partial<Record<LogStream, string>> }) {
  const { jobId, status, view, sessionExpired: liveExpired } = useLiveJobContext();
  const preview = previewLogs !== undefined;

  const [picked, setPicked] = useState<number | null>(null);
  const total = jobCount(view);
  const current = currentJobNumber(view);
  // The job whose output and messages are shown; undefined (the backend's
  // current job) for a simulation that has had only one.
  const job = total > 1 ? Math.min(picked ?? current, total) : undefined;
  const earlierJobs = view.previous_jobs.length > 0;

  const logs = useJobLogs({
    jobId,
    status,
    disabled: preview,
    job,
    jobEnded: job !== undefined && job < current,
    earlierJobs,
  });
  const previewStates = useMemo(
    () => ({
      wbm: previewStreamState(previewLogs?.wbm),
      stdout: previewStreamState(previewLogs?.stdout),
      stderr: previewStreamState(previewLogs?.stderr),
    }),
    [previewLogs]
  );
  const states = preview ? previewStates : logs.states;
  const box = useMemo(
    () => buildLogBox({ states, status, files: view.files, failure: view.failure, job, earlierJobs }),
    [states, status, view.files, view.failure, job, earlierJobs]
  );
  const text = box.kind === "rows" ? rowsToText(box.rows) : "";

  const [downloading, setDownloading] = useState(false);
  const [downloadExpired, setDownloadExpired] = useState(false);
  const sessionExpired = liveExpired || logs.sessionExpired || downloadExpired;

  const download = async (stream: LogStream) => {
    if (downloading) return;
    if (preview) {
      toast.info("Preview data — there is no real log to download.");
      return;
    }
    setDownloading(true);
    try {
      const res = await fetch(logDownloadUrl(jobId, stream, job), {
        cache: "no-store",
      });
      if (res.ok) {
        const blob = await res.blob();
        const name = filenameFromDisposition(res.headers.get("content-disposition"), `${jobId}-${stream}.log`);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
        setDownloadExpired(false);
      } else if (res.status === 401) {
        setDownloadExpired(true);
      } else {
        const body: unknown = await res.json().catch(() => null);
        toast.error(messageFromErrorBody(body, "Couldn't download the log. Try again."), {
          duration: 10_000,
        });
      }
    } catch {
      toast.error("Couldn't download the log. Check your connection and try again.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section
      aria-labelledby="logs-heading"
      className="space-y-3.5 rounded-card border border-border/70 bg-card p-6 shadow-card"
    >
      <div className="flex items-center justify-between gap-2 px-1.5">
        <h2 id="logs-heading" className="text-xl font-[650] tracking-[-0.02em] text-foreground">
          Logs
        </h2>
        <div className="flex flex-wrap justify-end gap-2">
          {job !== undefined && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Choose the job whose output and messages are shown"
                  className="min-h-10 shrink-0 gap-1.5 rounded-[9px] border-0 bg-muted px-3 text-[12.5px] font-semibold text-foreground shadow-none hover:bg-secondary hover:text-primary sm:min-h-8"
                >
                  Job {job}
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Job output and messages of
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={String(job)}
                  // The current job is followed, so the page moves on to the next one by itself.
                  onValueChange={(value) => setPicked(Number(value) === current ? null : Number(value))}
                >
                  {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
                    const note = n === current ? "current" : (view.previous_jobs.find((p) => p.number === n)?.slurm_state ?? null);
                    return (
                      <DropdownMenuRadioItem key={n} value={String(n)} className="min-h-10 sm:min-h-8">
                        Job {n}
                        {note && <span className="ml-2 font-mono text-xs text-muted-foreground">{note}</span>}
                      </DropdownMenuRadioItem>
                    );
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <CopyButton text={text} label="logs text" disabled={text === ""} />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={downloading}
                aria-label="Download a log"
                className="min-h-10 shrink-0 gap-1.5 rounded-[9px] border-0 bg-muted px-3 text-[12.5px] font-semibold text-foreground shadow-none hover:bg-secondary hover:text-primary sm:min-h-8"
              >
                {downloading ? (
                  <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="size-3.5" aria-hidden="true" />
                )}
                Download
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {LOG_SOURCES.map(({ stream }) => (
                <DropdownMenuItem
                  key={stream}
                  disabled={!preview && !states[stream].exists}
                  onSelect={() => void download(stream)}
                  className="min-h-10 sm:min-h-8"
                >
                  {sourceTitle(stream, job)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

        {box.kind === "loading" && <LogSkeleton />}
        {box.kind === "empty" && (
          <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed bg-muted/40 px-4 py-10 text-center">
            <FileText className="size-5 text-muted-foreground" aria-hidden="true" />
            <p className="max-w-sm text-sm text-muted-foreground">{box.message}</p>
          </div>
        )}
        {box.kind === "rows" && <LogBlock rows={box.rows} label="Simulation logs" onRetry={logs.retry} />}

        {sessionExpired && <SessionExpiredBanner />}
    </section>
  );
}
