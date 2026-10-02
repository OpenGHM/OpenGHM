"use client";

import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowDown, Download, FileText, Info, Loader2, RefreshCw, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyButton } from "@/components/workspace/copy-button";
import { useLiveJobContext } from "@/components/workspace/live-job-provider";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import type { FilesState, JobFailure, JobStatus, LogStream } from "@/lib/jobs/types";
import { displayLines, isEmptyText, MAX_LOG_LINES, toPlainText } from "@/lib/workspace/log-lines";
import { filenameFromDisposition, messageFromErrorBody } from "@/lib/workspace/log-download";
import { previewStreamState, type StreamState } from "@/lib/workspace/log-stream";
import {
  blankStreams,
  defaultLogStream,
  logEmptyMessage,
  LOG_STREAMS,
  logsReadable,
} from "@/lib/workspace/log-view";
import { formatBytes } from "@/lib/workspace/format";
import { useJobLogs } from "@/lib/workspace/use-job-logs";

/** How close to the bottom counts as "at the bottom", in px. */
const BOTTOM_SLACK = 24;

const LogLine = memo(function LogLine({
  number,
  text,
  digits,
}: {
  number: number;
  text: string;
  digits: number;
}) {
  return (
    <div className="flex gap-3">
      <span
        aria-hidden="true"
        className="shrink-0 select-none text-right text-slate-400"
        style={{ minWidth: `${digits}ch` }}
      >
        {number}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{text || " "}</span>
    </div>
  );
});

/**
 * The lines, dark and monospace, with a line-number gutter. It follows the end
 * of the log while the reader is at the bottom; scrolling up pauses that, and
 * "Jump to latest" (with how many lines came since) resumes it.
 */
function LogBlock({ lines, firstNumber, label }: { lines: string[]; firstNumber: number; label: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // The total line count when following was paused; null while following.
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const total = firstNumber - 1 + lines.length;
  const totalRef = useRef(total);
  const tail = lines[lines.length - 1];

  useLayoutEffect(() => {
    totalRef.current = total;
    const el = scrollRef.current;
    if (el && pausedAt === null) el.scrollTop = el.scrollHeight;
  }, [total, tail, pausedAt]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK;
    setPausedAt((paused) => (atBottom ? null : (paused ?? totalRef.current)));
  };

  const digits = String(total).length;
  const newLines = pausedAt === null ? 0 : Math.max(0, total - pausedAt);

  return (
    <div className="relative">
      {/* `aria-live="off"`: a log is polite by default, and this one grows
          every few seconds. The status panel is the one announcement point. */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="off"
        aria-label={label}
        tabIndex={0}
        onScroll={onScroll}
        className="max-h-[480px] min-h-24 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {lines.map((text, i) => (
          <LogLine key={firstNumber + i} number={firstNumber + i} text={text} digits={digits} />
        ))}
      </div>
      {pausedAt !== null && (
        <Button
          type="button"
          size="sm"
          onClick={() => setPausedAt(null)}
          className="absolute right-3 bottom-3 min-h-10 shadow-md sm:min-h-8"
        >
          <ArrowDown className="size-4" aria-hidden="true" />
          Jump to latest
          {newLines > 0 && (
            <span className="tabular-nums">
              ({newLines.toLocaleString("en-US")} new)
            </span>
          )}
        </Button>
      )}
    </div>
  );
}

function LogSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading the log"
      className="space-y-2.5 rounded-lg bg-slate-900 p-4"
    >
      {["w-4/5", "w-3/5", "w-11/12", "w-2/5", "w-3/4", "w-1/2"].map((w, i) => (
        <Skeleton key={i} className={`h-3 ${w} animate-none bg-slate-700 motion-safe:animate-pulse`} />
      ))}
    </div>
  );
}

function LogPane({
  stream,
  state,
  status,
  files,
  failure,
  wbmLog,
  fetching,
  onRetry,
  onDownload,
}: {
  stream: LogStream;
  state: StreamState;
  status: JobStatus;
  files: FilesState | null;
  failure: Pick<JobFailure, "cause" | "excerpt"> | null;
  /** WBM's log may have something to show (see `logEmptyMessage`). */
  wbmLog: boolean;
  /** Reads happen for this job (not the dev preview). */
  fetching: boolean;
  onRetry: () => void;
  onDownload: () => void;
}) {
  const label = LOG_STREAMS.find((s) => s.stream === stream)?.label ?? stream;
  const lines = useMemo(() => displayLines(state.text), [state.text]);
  const empty = isEmptyText(state.text);
  const loading = fetching && logsReadable(status) && !state.loaded;
  const emptyMessage = logEmptyMessage({
    status,
    files,
    stream,
    hasText: !empty,
    exists: state.exists,
    failure,
    wbmLog,
  });

  return (
    <div className="space-y-3">
      {(state.startedMidway || state.text.dropped > 0) && (
        <div className="flex items-start gap-2 rounded-lg border bg-muted/50 p-2.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <p className="min-w-0">
            {state.text.dropped > 0
              ? `Showing the last ${MAX_LOG_LINES.toLocaleString("en-US")} lines of a ${formatBytes(state.size)} log. `
              : `Showing the end of a ${formatBytes(state.size)} log. `}
            <button
              type="button"
              onClick={onDownload}
              className="rounded-sm font-medium text-foreground underline underline-offset-2 outline-none hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              Download it
            </button>{" "}
            for the whole file.
          </p>
        </div>
      )}

      {state.error && (
        <div className="flex flex-col gap-2 rounded-lg border border-status-failed/25 bg-status-failed/5 p-3 text-sm text-status-failed sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{state.error}</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="min-h-10 shrink-0 bg-background sm:min-h-8"
          >
            <RefreshCw className="mr-1.5 size-4" aria-hidden="true" />
            Retry
          </Button>
        </div>
      )}

      {loading ? (
        <LogSkeleton />
      ) : !empty ? (
        <LogBlock lines={lines} firstNumber={state.text.dropped + 1} label={label} />
      ) : (
        !state.error &&
        emptyMessage && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center">
            <FileText className="size-5 text-muted-foreground" aria-hidden="true" />
            <p className="max-w-sm text-sm text-muted-foreground">{emptyMessage}</p>
          </div>
        )
      )}

      {!empty && (
        <p className="text-xs text-muted-foreground tabular-nums">
          {(state.text.dropped + lines.length).toLocaleString("en-US")} lines · {formatBytes(state.size)}
        </p>
      )}
    </div>
  );
}

/**
 * A job's three logs (ADR 0027): WBM's own, and SLURM's output and errors. It
 * reads the one on show as it grows, follows the end, and downloads the whole
 * file through the route handler. `previewLogs` is fixture text for the dev
 * preview, shown without reading anything.
 */
export function LogViewer({ previewLogs }: { previewLogs?: Partial<Record<LogStream, string>> }) {
  const { jobId, status, view, sessionExpired: liveExpired } = useLiveJobContext();
  const preview = previewLogs !== undefined;

  // The tab follows the job until the person picks one: the page may have been
  // rendered while SUBMITTED (Output) and the job moves on to RUNNING (WBM log),
  // and an ended job's WBM log may turn out to be missing (`defaultLogStream`).
  const [picked, setPicked] = useState<LogStream | null>(null);
  const logs = useJobLogs({ jobId, picked, status, disabled: preview });
  const previewStates = useMemo(
    () => ({
      wbm: previewStreamState(previewLogs?.wbm),
      stdout: previewStreamState(previewLogs?.stdout),
      stderr: previewStreamState(previewLogs?.stderr),
    }),
    [previewLogs]
  );
  const states = preview ? previewStates : logs.states;
  const stream = preview ? (picked ?? defaultLogStream(status, blankStreams(previewStates))) : logs.stream;
  const state = states[stream];
  const wbmLog = !blankStreams(states).wbm;

  const [downloading, setDownloading] = useState(false);
  const [downloadExpired, setDownloadExpired] = useState(false);
  const sessionExpired = liveExpired || logs.sessionExpired || downloadExpired;

  const text = useMemo(() => toPlainText(state.text), [state.text]);
  const label = LOG_STREAMS.find((s) => s.stream === stream)?.label ?? stream;

  const download = async () => {
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
    <Card className="overflow-hidden rounded-xl border-0 gap-0 py-0 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-r from-slate-500/5 to-transparent !py-4 !gap-0 grid-rows-1 items-center">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <div className="flex size-8 items-center justify-center rounded-lg bg-slate-500/10">
            <Terminal className="size-4 text-slate-600" aria-hidden="true" />
          </div>
          Logs
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3 pt-5 pb-6">
        <Tabs value={stream} onValueChange={(next) => setPicked(next as LogStream)} className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TabsList aria-label="Log files" className="h-auto w-full sm:w-auto">
              {LOG_STREAMS.map((s) => (
                <TabsTrigger key={s.stream} value={s.stream} className="min-h-10 px-3 text-xs sm:min-h-8">
                  {s.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="flex gap-2">
              <CopyButton text={text} label={`${label.toLowerCase()} text`} disabled={isEmptyText(state.text)} />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void download()}
                disabled={downloading || (!preview && !state.exists)}
                aria-label={`Download ${label.toLowerCase()}`}
                className="min-h-10 shrink-0 gap-1.5 px-3 text-xs text-muted-foreground hover:text-foreground sm:min-h-8"
              >
                {downloading ? (
                  <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="size-3.5" aria-hidden="true" />
                )}
                Download
              </Button>
            </div>
          </div>

          {LOG_STREAMS.map((s) => (
            <TabsContent key={s.stream} value={s.stream}>
              <LogPane
                stream={s.stream}
                state={states[s.stream]}
                status={status}
                files={view.files}
                failure={view.failure}
                wbmLog={wbmLog}
                fetching={!preview}
                onRetry={logs.retry}
                onDownload={() => void download()}
              />
            </TabsContent>
          ))}
        </Tabs>

        {sessionExpired && <SessionExpiredBanner />}
      </CardContent>
    </Card>
  );
}
