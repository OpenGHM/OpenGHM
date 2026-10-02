"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CopyButton } from "@/components/workspace/copy-button";
import { LogBlock, LogNotices, LogSkeleton } from "@/components/workspace/log-block";
import type { FilesState, JobFailure, JobStatus, LogStream } from "@/lib/jobs/types";
import { isTerminalStatus } from "@/lib/jobs/types";
import { isEmptyText } from "@/lib/workspace/log-lines";
import {
  collapseProgress,
  errorCount,
  errorKeys,
  failureReasonLines,
  fetchesDone,
  lineCount,
  lineRows,
  markReason,
  nextErrorIndex,
  onlyErrorRows,
  rowsToText,
  splitStderr,
  type LogRow,
  type SectionId,
} from "@/lib/workspace/log-sections";
import type { StreamState } from "@/lib/workspace/log-stream";
import { LOG_STREAMS, logEmptyMessage, logsReadable } from "@/lib/workspace/log-view";
import type { LogStates } from "@/lib/workspace/use-job-logs";

const SECTION_BOX = "max-h-80";
const BUTTON = "min-h-10 shrink-0 text-xs sm:min-h-8";

/** The download menu: the sources in the order the sections are shown. */
const DOWNLOADS = (["stdout", "wbm", "stderr"] as const).map((stream) => ({
  stream,
  label: LOG_STREAMS.find((s) => s.stream === stream)?.label ?? stream,
}));

/** What a line count says: "1 line", "2 lines". */
const plural = (n: number, one: string) => `${n.toLocaleString("en-US")} ${one}${n === 1 ? "" : "s"}`;

interface Section {
  id: SectionId;
  stream: LogStream;
  title: string;
  /** Every row of the section. */
  rows: LogRow[];
  /** The number of its last line in the file. */
  total: number;
  /** Lines in the file, the ones dropped from the front included. */
  lines: number;
}

/** The number of the last line the rows stand for. */
function lastNumber(rows: LogRow[], fallback: number): number {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.kind === "line") return row.number;
    if (row.kind === "summary") return row.number + row.lines - 1;
  }
  return fallback;
}

function SectionHeader({
  title,
  lines,
  errors,
  open,
  onToggle,
  regionId,
}: {
  title: string;
  lines: number | null;
  errors: number;
  /** Set for a section that folds. */
  open?: boolean;
  onToggle?: () => void;
  regionId: string;
}) {
  const meta = (
    <span className="text-xs font-normal text-muted-foreground tabular-nums">
      {lines !== null && plural(lines, "line")}
      {errors > 0 && (
        <span className="font-medium text-status-failed">
          {lines !== null && " · "}
          {plural(errors, "error")}
        </span>
      )}
    </span>
  );
  if (onToggle) {
    return (
      <h3 className="text-sm font-semibold">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={regionId}
          className="-ml-1 flex min-h-10 w-full flex-wrap items-center gap-x-2 rounded-md px-1 text-left outline-none hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8"
        >
          {open ? (
            <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
          )}
          {title}
          {meta}
        </button>
      </h3>
    );
  }
  return (
    <h3 className="flex flex-wrap items-baseline gap-x-2 py-1 text-sm font-semibold">
      {title}
      {meta}
    </h3>
  );
}

/**
 * The three logs in one place, stacked by source because the files carry no
 * shared timestamps: the setup messages (stderr before the job body's marker,
 * folded), the job's output, WBM's log, and the messages after the marker with
 * the download counter as one line. Lines that look like errors are red in
 * every section; the row above counts them and steps through them, opening the
 * folded section when one is in it. A section whose file is missing, empty, or
 * could not be read says so by itself and does not stop the others.
 */
export function AllLogs({
  states,
  status,
  files,
  failure,
  wbmLog,
  preview,
  downloading,
  onRetry,
  onDownload,
}: {
  states: LogStates;
  status: JobStatus;
  files: FilesState | null;
  failure: Pick<JobFailure, "cause" | "excerpt"> | null;
  /** WBM's log may have something to show (see `logEmptyMessage`). */
  wbmLog: boolean;
  /** Fixture text: nothing is read, nothing can be downloaded. */
  preview: boolean;
  downloading: boolean;
  onRetry: (stream: LogStream) => void;
  onDownload: (stream: LogStream) => void;
}) {
  const live = !isTerminalStatus(status);
  const idBase = useId();
  const [setupOpen, setSetupOpen] = useState(false);
  const [onlyErrors, setOnlyErrors] = useState(false);
  // The error the last jump went to. A jump scrolls; a new line arriving does not.
  const [target, setTarget] = useState<{ section: SectionId; number: number } | null>(null);

  const stdoutRows = useMemo(() => lineRows(states.stdout.text), [states.stdout.text]);
  const wbmRows = useMemo(() => lineRows(states.wbm.text), [states.wbm.text]);
  // A failed job's reason, as the failure card quotes it, is red too.
  const reason = useMemo(
    () => (status === "FAILED" ? failureReasonLines(failure?.excerpt) : new Set<string>()),
    [status, failure?.excerpt]
  );
  const stderrRows = useMemo(
    () => markReason(lineRows(states.stderr.text), reason),
    [states.stderr.text, reason]
  );
  const split = useMemo(() => splitStderr(stderrRows), [stderrRows]);
  const fetches = useMemo(() => fetchesDone(stdoutRows), [stdoutRows]);
  const messageRows = useMemo(() => collapseProgress(split.body, { live, fetches }), [split.body, live, fetches]);

  const sections: Section[] = [
    { id: "setup", stream: "stderr", title: "Setup messages (module loading)", rows: split.setup, total: lastNumber(split.setup, 0), lines: split.setup.length },
    { id: "stdout", stream: "stdout", title: "Job output", rows: stdoutRows, total: lastNumber(stdoutRows, 0), lines: states.stdout.text.dropped + stdoutRows.length },
    { id: "wbm", stream: "wbm", title: "WBM log", rows: wbmRows, total: lastNumber(wbmRows, 0), lines: states.wbm.text.dropped + wbmRows.length },
    { id: "messages", stream: "stderr", title: "Messages", rows: messageRows, total: lastNumber(messageRows, 0), lines: lineCount(messageRows) },
  ];
  // Setup messages show only when there are some; stderr with no marker is all messages.
  const shown = sections.filter((s) => s.id !== "setup" || (s.rows.length > 0 && (!onlyErrors || errorCount(s.rows) > 0)));
  const keys = errorKeys(sections);
  const errors = keys.length;
  const currentIndex = target ? keys.indexOf(`${target.section}:${target.number}`) : -1;

  const rowsOf = (s: Section): LogRow[] => (onlyErrors ? onlyErrorRows(s.rows) : s.rows);
  const open = (s: Section) => s.id !== "setup" || setupOpen;

  const goTo = (index: number) => {
    const key = keys[index];
    if (!key) return;
    const [section, number] = key.split(":");
    if (section === "setup") setSetupOpen(true);
    setTarget({ section: section as SectionId, number: Number(number) });
  };

  // Each jump sets a new `target`, and nothing else does, so lines arriving
  // after a jump do not scroll the reader away from it.
  useEffect(() => {
    if (!target) return;
    document
      .getElementById(`${idBase}-${target.section}-${target.number}`)
      ?.scrollIntoView?.({ block: "center" });
  }, [target, idBase]);

  const copyText = shown
    .filter(open)
    .map((s) => ({ s, rows: rowsOf(s) }))
    .filter(({ rows }) => rows.length > 0)
    .map(({ s, rows }) => `== ${s.title} (${plural(s.lines, "line")}) ==\n${rowsToText(rows)}`)
    .join("\n\n");

  const settled = LOG_STREAMS.every(({ stream }) => states[stream].loaded && !states[stream].error);
  const nothingThere =
    files === "purged" && LOG_STREAMS.every(({ stream }) => states[stream].loaded && !states[stream].exists);

  if (!preview && (!logsReadable(status) || nothingThere)) {
    const message = logEmptyMessage({ status, files, stream: "stdout", hasText: false, exists: false });
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed bg-muted/30 px-4 py-10 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      </div>
    );
  }

  const summary =
    errors > 0 ? (
      <>
        <AlertTriangle className="size-4 shrink-0 text-status-failed" aria-hidden="true" />
        <span className="font-medium text-status-failed">{plural(errors, "error line")}</span>
      </>
    ) : (
      <>
        <CheckCircle2 className="size-4 shrink-0 text-status-completed" aria-hidden="true" />
        <span className="font-medium">
          {settled ? "No errors found in the logs" : "No errors found in the logs read so far"}
        </span>
      </>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:flex-wrap sm:items-center">
        <p className="flex min-w-0 flex-1 items-center gap-2 text-sm sm:basis-48">{summary}</p>
        <div className="flex flex-wrap items-center gap-2">
          {errors > 0 && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => goTo(0)} className={BUTTON}>
                First error
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => goTo(nextErrorIndex(currentIndex === -1 ? null : currentIndex, errors))}
                className={BUTTON}
              >
                Next error
              </Button>
              {currentIndex !== -1 && (
                <span role="status" className="text-xs text-muted-foreground tabular-nums">
                  Error {currentIndex + 1} of {errors}
                </span>
              )}
            </>
          )}
          <Button
            type="button"
            variant={onlyErrors ? "default" : "outline"}
            size="sm"
            aria-pressed={onlyErrors}
            onClick={() => setOnlyErrors((v) => !v)}
            className={BUTTON}
          >
            Show only errors
          </Button>
          <CopyButton text={copyText} label="all logs text" disabled={copyText === ""} />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={downloading}
                aria-label="Download a log"
                className={`${BUTTON} gap-1.5 px-3 text-muted-foreground hover:text-foreground`}
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
              {DOWNLOADS.map(({ stream, label }) => (
                <DropdownMenuItem
                  key={stream}
                  disabled={!preview && !states[stream].exists}
                  onSelect={() => onDownload(stream)}
                  className="min-h-10 sm:min-h-8"
                >
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {shown.map((s) => {
        const state = states[s.stream];
        const regionId = `${idBase}-region-${s.id}`;
        const isSetup = s.id === "setup";
        const rows = rowsOf(s);
        const expanded = open(s);
        const loaded = state.loaded && s.rows.length > 0;
        return (
          <section key={s.id} aria-label={s.title} className="space-y-2">
            <SectionHeader
              title={s.title}
              lines={loaded ? s.lines : null}
              errors={errorCount(s.rows)}
              open={isSetup ? expanded : undefined}
              onToggle={isSetup ? () => setSetupOpen((v) => !v) : undefined}
              regionId={regionId}
            />
            {expanded && (
              <div id={regionId} className="space-y-2">
                {!isSetup && (
                  <LogNotices state={state} onRetry={() => onRetry(s.stream)} onDownload={() => onDownload(s.stream)} />
                )}
                <SectionBody
                  section={s}
                  rows={rows}
                  state={state}
                  fetching={!preview}
                  status={status}
                  files={files}
                  failure={failure}
                  wbmLog={wbmLog}
                  onlyErrors={onlyErrors}
                  afterSetup={split.setup.length > 0}
                  idPrefix={`${idBase}-${s.id}`}
                  currentNumber={target?.section === s.id ? target.number : null}
                />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function SectionBody({
  section,
  rows,
  state,
  fetching,
  status,
  files,
  failure,
  wbmLog,
  onlyErrors,
  afterSetup,
  idPrefix,
  currentNumber,
}: {
  section: Section;
  /** The rows to draw: the section's, or its error lines with context. */
  rows: LogRow[];
  state: StreamState;
  fetching: boolean;
  status: JobStatus;
  files: FilesState | null;
  failure: Pick<JobFailure, "cause" | "excerpt"> | null;
  wbmLog: boolean;
  onlyErrors: boolean;
  afterSetup: boolean;
  idPrefix: string;
  currentNumber: number | null;
}): ReactNode {
  if (fetching && logsReadable(status) && !state.loaded) return <LogSkeleton label={`Loading ${section.title}`} />;
  if (rows.length > 0) {
    return (
      <LogBlock
        rows={rows}
        total={section.total}
        label={section.title}
        className={SECTION_BOX}
        idPrefix={idPrefix}
        currentNumber={currentNumber}
      />
    );
  }
  if (onlyErrors && section.rows.length > 0) {
    return <p className="text-sm text-muted-foreground">No error lines in this section.</p>;
  }
  if (state.error && isEmptyText(state.text)) return null;
  const message = logEmptyMessage({
    status,
    files,
    stream: section.stream,
    hasText: false,
    exists: state.exists,
    failure,
    wbmLog,
    afterSetup,
  });
  return message ? <p className="text-sm text-muted-foreground">{message}</p> : null;
}
