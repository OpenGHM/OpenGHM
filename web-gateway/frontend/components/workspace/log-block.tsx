"use client";

import { memo, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, Info, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/workspace/format";
import { MAX_LOG_LINES } from "@/lib/workspace/log-lines";
import type { LogRow } from "@/lib/workspace/log-sections";
import type { LineSeverity } from "@/lib/workspace/log-severity";
import type { StreamState } from "@/lib/workspace/log-stream";

/** How close to the bottom counts as "at the bottom", in px. */
const BOTTOM_SLACK = 24;

/**
 * The tints of a line that looks like trouble, on the dark log box. The status
 * hues are tuned for light surfaces (AA as text on a tint of themselves), so
 * here they only tint the background, and the text is a light step of the same
 * hue. Colour is never the only sign: the marker and the hidden word say it too.
 */
const SEVERITY: Record<LineSeverity, { row: string; mark: string; word: string }> = {
  error: { row: "bg-status-failed/25 text-red-200", mark: "!", word: "Error: " },
  warning: { row: "bg-warning/25 text-amber-200", mark: "▲", word: "Warning: " },
};

interface RowProps {
  kind: LogRow["kind"];
  number: number;
  text: string;
  severity: LineSeverity | null;
  /** The digits of the widest line number. */
  digits: number;
  /** The error "Next error" stopped at. */
  current: boolean;
  /** The id a jump scrolls to. */
  domId?: string;
  /** Lines a summary stands for, or lines a gap leaves out. */
  count: number;
}

const LogRowView = memo(function LogRowView({ kind, number, text, severity, digits, current, domId, count }: RowProps) {
  if (kind === "gap") {
    return (
      <div className="flex gap-3 py-0.5 text-slate-400 italic">
        <span aria-hidden="true" className="w-[1ch] shrink-0" />
        <span aria-hidden="true" className="shrink-0" style={{ minWidth: `${digits}ch` }} />
        <span className="min-w-0 flex-1">
          {count.toLocaleString("en-US")} {count === 1 ? "line" : "lines"} without errors hidden
        </span>
      </div>
    );
  }
  const tone = severity ? SEVERITY[severity] : null;
  return (
    <div
      id={domId}
      data-severity={severity ?? undefined}
      data-current={current ? "true" : undefined}
      className={`-mx-3 flex gap-3 px-3 ${tone?.row ?? ""} ${current ? "ring-2 ring-red-300 ring-inset" : ""}`}
    >
      <span aria-hidden="true" data-marker className="w-[1ch] shrink-0 text-center font-bold select-none">
        {tone?.mark}
      </span>
      <span
        aria-hidden="true"
        data-line-number
        className="shrink-0 select-none text-right text-slate-400"
        style={{ minWidth: `${digits}ch` }}
      >
        {number}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
        {tone && <span className="sr-only">{tone.word}</span>}
        {text || " "}
        {kind === "summary" && (
          <span className="text-slate-400">
            {" "}
            ({count.toLocaleString("en-US")} progress lines)
          </span>
        )}
      </span>
    </div>
  );
});

/**
 * The rows, dark and monospace, with a line-number gutter. It follows the end
 * of the log while the reader is at the bottom; scrolling up pauses that, and
 * "Jump to latest" (with how many lines came since) resumes it. `total` is the
 * number of the last line, so a filtered view still counts what came in.
 */
export function LogBlock({
  rows,
  total,
  label,
  className = "max-h-[480px]",
  idPrefix,
  currentNumber = null,
}: {
  rows: LogRow[];
  total: number;
  label: string;
  className?: string;
  /** Gives each error line an id, `${idPrefix}-${number}`, to scroll to. */
  idPrefix?: string;
  /** The number of the error line to mark as the current one. */
  currentNumber?: number | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // The total line count when following was paused; null while following.
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const totalRef = useRef(total);

  useLayoutEffect(() => {
    totalRef.current = total;
    const el = scrollRef.current;
    if (el && pausedAt === null) el.scrollTop = el.scrollHeight;
  }, [rows, total, pausedAt]);

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
        className={`${className} min-h-24 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50`}
      >
        {rows.map((row, i) => {
          const number = row.kind === "gap" ? 0 : row.number;
          return (
            <LogRowView
              key={row.kind === "gap" ? `gap-${i}` : `${row.kind}-${number}`}
              kind={row.kind}
              number={number}
              text={row.kind === "gap" ? "" : row.text}
              severity={row.kind === "line" ? row.severity : null}
              digits={digits}
              current={row.kind === "line" && row.severity === "error" && row.number === currentNumber}
              domId={idPrefix && row.kind === "line" && row.severity === "error" ? `${idPrefix}-${row.number}` : undefined}
              count={row.kind === "gap" ? row.hidden : row.kind === "summary" ? row.lines : 0}
            />
          );
        })}
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
          {newLines > 0 && <span className="tabular-nums">({newLines.toLocaleString("en-US")} new)</span>}
        </Button>
      )}
    </div>
  );
}

/** Stand-in lines while a log's first read is out. The wrapper fades in after
 *  300 ms (`reveal-delayed`), so a read that answers quickly shows none. */
export function LogSkeleton({ label = "Loading the log" }: { label?: string }) {
  return (
    <div
      aria-busy="true"
      aria-label={label}
      className="reveal-delayed space-y-2.5 rounded-lg bg-slate-900 p-4"
    >
      {["w-4/5", "w-3/5", "w-11/12", "w-2/5", "w-3/4", "w-1/2"].map((w, i) => (
        <Skeleton key={i} className={`h-3 ${w} animate-none bg-slate-700 motion-safe:animate-pulse`} />
      ))}
    </div>
  );
}

/**
 * What to say above a stream's lines: that only the end of a long file is
 * shown (with a way to the whole file), and that the last read failed (with
 * Retry; the lines read so far stay).
 */
export function LogNotices({
  state,
  onRetry,
  onDownload,
}: {
  state: StreamState;
  onRetry: () => void;
  onDownload: () => void;
}) {
  return (
    <>
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
    </>
  );
}
