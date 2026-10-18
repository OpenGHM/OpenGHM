"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CopyButton } from "@/components/workspace/copy-button";
import { LogBlock, LogSkeleton } from "@/components/workspace/log-block";
import { useLiveJobContext } from "@/components/workspace/live-job-provider";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import type { LogStream } from "@/lib/jobs/types";
import { filenameFromDisposition, messageFromErrorBody } from "@/lib/workspace/log-download";
import { buildLogBox, LOG_SOURCES } from "@/lib/workspace/log-box";
import { rowsToText } from "@/lib/workspace/log-sections";
import { previewStreamState } from "@/lib/workspace/log-stream";
import { useJobLogs } from "@/lib/workspace/use-job-logs";

/**
 * A job's logs (ADR 0027) in one box: the three files on Anvil laid end to end
 * in the order they happen, with a plain separator line at the start of each
 * (`buildLogBox`). It reads them as they grow, follows the end, and downloads
 * a whole file through the route handler. `previewLogs` is fixture text for
 * the dev preview, shown without reading anything.
 */
export function LogViewer({ previewLogs }: { previewLogs?: Partial<Record<LogStream, string>> }) {
  const { jobId, status, view, sessionExpired: liveExpired } = useLiveJobContext();
  const preview = previewLogs !== undefined;

  const logs = useJobLogs({ jobId, status, disabled: preview });
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
    () => buildLogBox({ states, status, files: view.files, failure: view.failure }),
    [states, status, view.files, view.failure]
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
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/logs/${stream}`, {
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
        <div className="flex gap-2">
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
              {LOG_SOURCES.map(({ stream, label }) => (
                <DropdownMenuItem
                  key={stream}
                  disabled={!preview && !states[stream].exists}
                  onSelect={() => void download(stream)}
                  className="min-h-10 sm:min-h-8"
                >
                  {label}
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
