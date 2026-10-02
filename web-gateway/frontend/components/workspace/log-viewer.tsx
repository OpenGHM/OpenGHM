"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, FileText, Loader2, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyButton } from "@/components/workspace/copy-button";
import { AllLogs } from "@/components/workspace/log-all-view";
import { LogBlock, LogNotices, LogSkeleton } from "@/components/workspace/log-block";
import { useLiveJobContext } from "@/components/workspace/live-job-provider";
import { SessionExpiredBanner } from "@/components/workspace/session-expired-banner";
import type { FilesState, JobFailure, JobStatus, LogStream } from "@/lib/jobs/types";
import { isEmptyText, toPlainText } from "@/lib/workspace/log-lines";
import { filenameFromDisposition, messageFromErrorBody } from "@/lib/workspace/log-download";
import { failureReasonLines, lineRows, markReason } from "@/lib/workspace/log-sections";
import { previewStreamState, type StreamState } from "@/lib/workspace/log-stream";
import {
  ALL_TAB,
  blankStreams,
  logEmptyMessage,
  LOG_STREAMS,
  logsReadable,
  type LogTab,
} from "@/lib/workspace/log-view";
import { formatBytes } from "@/lib/workspace/format";
import { useJobLogs } from "@/lib/workspace/use-job-logs";

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
  const reasonExcerpt = status === "FAILED" ? failure?.excerpt : null;
  const rows = useMemo(() => {
    const all = lineRows(state.text);
    return stream === "stderr" ? markReason(all, failureReasonLines(reasonExcerpt)) : all;
  }, [state.text, stream, reasonExcerpt]);
  const empty = isEmptyText(state.text);
  const loading = fetching && logsReadable(status) && !state.loaded;
  const total = state.text.dropped + rows.length;
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
      <LogNotices state={state} onRetry={onRetry} onDownload={onDownload} />

      {loading ? (
        <LogSkeleton />
      ) : !empty ? (
        <LogBlock rows={rows} total={total} label={label} />
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
          {total.toLocaleString("en-US")} lines · {formatBytes(state.size)}
        </p>
      )}
    </div>
  );
}

/**
 * A job's logs (ADR 0027): the three files on Anvil, WBM's own log and the job
 * script's output and stderr, together in the All tab (`AllLogs`) and one by
 * one in the others. It reads what is on show as it grows, follows the end,
 * and downloads the whole file through the route handler. `previewLogs` is
 * fixture text for the dev preview, shown without reading anything.
 */
export function LogViewer({ previewLogs }: { previewLogs?: Partial<Record<LogStream, string>> }) {
  const { jobId, status, view, sessionExpired: liveExpired } = useLiveJobContext();
  const preview = previewLogs !== undefined;

  const [tab, setTab] = useState<LogTab>("all");
  const logs = useJobLogs({ jobId, tab, status, disabled: preview });
  const previewStates = useMemo(
    () => ({
      wbm: previewStreamState(previewLogs?.wbm),
      stdout: previewStreamState(previewLogs?.stdout),
      stderr: previewStreamState(previewLogs?.stderr),
    }),
    [previewLogs]
  );
  const states = preview ? previewStates : logs.states;
  const wbmLog = !blankStreams(states).wbm;

  const [downloading, setDownloading] = useState(false);
  const [downloadExpired, setDownloadExpired] = useState(false);
  const sessionExpired = liveExpired || logs.sessionExpired || downloadExpired;

  const source = tab === "all" ? null : tab;
  const sourceState = source ? states[source] : null;
  const sourceLabel = LOG_STREAMS.find((s) => s.stream === source)?.label ?? "";
  const text = useMemo(() => (sourceState ? toPlainText(sourceState.text) : ""), [sourceState]);
  const caption = source ? LOG_STREAMS.find((s) => s.stream === source)?.caption : ALL_TAB.caption;

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
        <Tabs value={tab} onValueChange={(next) => setTab(next as LogTab)} className="gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <TabsList aria-label="Log files" className="h-auto w-full sm:w-auto">
              <TabsTrigger value={ALL_TAB.tab} className="min-h-10 px-3 text-xs sm:min-h-8">
                {ALL_TAB.label}
              </TabsTrigger>
              {LOG_STREAMS.map((s) => (
                <TabsTrigger key={s.stream} value={s.stream} className="min-h-10 px-3 text-xs sm:min-h-8">
                  {s.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {source && sourceState && (
              <div className="flex gap-2">
                <CopyButton
                  text={text}
                  label={`${sourceLabel.toLowerCase()} text`}
                  disabled={isEmptyText(sourceState.text)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void download(source)}
                  disabled={downloading || (!preview && !sourceState.exists)}
                  aria-label={`Download ${sourceLabel.toLowerCase()}`}
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
            )}
          </div>

          <p className="text-xs text-muted-foreground">{caption}</p>

          <TabsContent value={ALL_TAB.tab}>
            <AllLogs
              states={states}
              status={status}
              files={view.files}
              failure={view.failure}
              wbmLog={wbmLog}
              preview={preview}
              downloading={downloading}
              onRetry={logs.retry}
              onDownload={(stream) => void download(stream)}
            />
          </TabsContent>
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
                onRetry={() => logs.retry(s.stream)}
                onDownload={() => void download(s.stream)}
              />
            </TabsContent>
          ))}
        </Tabs>

        {sessionExpired && <SessionExpiredBanner />}
      </CardContent>
    </Card>
  );
}
