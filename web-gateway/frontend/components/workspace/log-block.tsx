"use client";

import { memo, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { LogStream } from "@/lib/jobs/types";
import type { LogRow } from "@/lib/workspace/log-sections";
import type { LineSeverity } from "@/lib/workspace/log-severity";

/** How close to the bottom counts as "at the bottom", in px. */
const BOTTOM_SLACK = 24;

/**
 * The tints of a line that looks like trouble, on the dark log box. The status
 * hues are tuned for light surfaces (AA as text on a tint of themselves), so
 * here they only tint the background, and the text is the light colour the band
 * has for the same thing (`hero-error`, `hero-attention-text`). Colour is never
 * the only sign: the marker and the hidden word say it too.
 */
const SEVERITY: Record<LineSeverity, { row: string; mark: string; word: string }> = {
  error: { row: "bg-status-failed/25 text-hero-error", mark: "!", word: "Error: " },
  warning: { row: "bg-hero-attention/12 text-hero-attention-text", mark: "▲", word: "Warning: " },
};

interface RowProps {
  kind: LogRow["kind"];
  number: number;
  text: string;
  severity: LineSeverity | null;
  /** The stream a note's Retry button reads, when it has one. */
  retry?: LogStream;
  onRetry: (stream: LogStream) => void;
  /** The digits of the widest line number. */
  digits: number;
}

const LogRowView = memo(function LogRowView({ kind, number, text, severity, retry, onRetry, digits }: RowProps) {
  if (kind === "separator") {
    return <div className="mt-3 mb-1 px-[18px] font-semibold text-hero-eyebrow first:mt-0">{text}</div>;
  }
  if (kind === "note") {
    return (
      <div className="flex flex-wrap items-center gap-x-3 px-[18px] text-hero-subtle italic">
        <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
        {retry && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onRetry(retry)}
            className="my-1 min-h-10 border-white/20 bg-white/10 text-xs text-hero-text not-italic hover:bg-white/15 hover:text-white sm:min-h-8"
          >
            <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
            Retry
          </Button>
        )}
      </div>
    );
  }
  const tone = severity ? SEVERITY[severity] : null;
  return (
    <div data-severity={severity ?? undefined} className={`flex gap-3.5 pr-[18px] ${tone?.row ?? ""}`}>
      {/* The gutter: the marker of a line that looks like trouble, then its
          number, right-aligned against the text. */}
      <span aria-hidden="true" className="flex w-16 shrink-0 items-baseline justify-end gap-1.5 select-none">
        <span data-marker className="w-[1ch] text-center font-bold">
          {tone?.mark}
        </span>
        <span data-line-number className="text-right text-hero-faint" style={{ minWidth: `${digits}ch` }}>
          {number}
        </span>
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
        {tone && <span className="sr-only">{tone.word}</span>}
        {text || " "}
      </span>
    </div>
  );
});

/**
 * The rows, dark and monospace, with a line-number gutter. It follows the end
 * of the log while the reader is at the bottom; scrolling up pauses that, and
 * "Jump to latest" (with how many rows came since) resumes it.
 */
export function LogBlock({
  rows,
  label,
  onRetry,
}: {
  rows: LogRow[];
  label: string;
  onRetry: (stream: LogStream) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // The row count when following was paused; null while following.
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const totalRef = useRef(rows.length);

  useLayoutEffect(() => {
    totalRef.current = rows.length;
    const el = scrollRef.current;
    if (el && pausedAt === null) el.scrollTop = el.scrollHeight;
  }, [rows, pausedAt]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK;
    setPausedAt((paused) => (atBottom ? null : (paused ?? totalRef.current)));
  };

  let widest = 0;
  for (const row of rows) {
    if (row.kind === "line") widest = Math.max(widest, row.number);
  }
  const digits = String(widest).length;
  const newRows = pausedAt === null ? 0 : Math.max(0, rows.length - pausedAt);

  return (
    <div className="relative">
      {/* `aria-live="off"`: a log is polite by default, and this one grows
          every few seconds. The header is the one announcement point. */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="off"
        aria-label={label}
        tabIndex={0}
        onScroll={onScroll}
        className="relative max-h-[440px] min-h-24 overflow-auto rounded-[14px] bg-hero py-4 font-mono text-[12.5px] leading-[1.75] text-hero-text outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {rows.map((row, i) => (
          <LogRowView
            key={i}
            kind={row.kind}
            number={row.kind === "line" ? row.number : 0}
            text={row.text}
            severity={row.kind === "line" ? row.severity : null}
            retry={row.kind === "note" ? row.retry : undefined}
            onRetry={onRetry}
            digits={digits}
          />
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
          {newRows > 0 && <span className="tabular-nums">({newRows.toLocaleString("en-US")} new)</span>}
        </Button>
      )}
    </div>
  );
}

/** Stand-in lines while the first reads are out. The wrapper fades in after
 *  300 ms (`reveal-delayed`), so a read that answers quickly shows none. */
export function LogSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the log" className="reveal-delayed space-y-2.5 rounded-[14px] bg-hero p-4">
      {["w-4/5", "w-3/5", "w-11/12", "w-2/5", "w-3/4", "w-1/2"].map((w, i) => (
        <Skeleton key={i} className={`h-3 ${w} animate-none bg-white/15 motion-safe:animate-pulse`} />
      ))}
    </div>
  );
}
