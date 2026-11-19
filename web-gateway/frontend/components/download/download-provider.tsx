"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  FileArchive,
  FileChartColumn,
  FileDown,
  Info,
  Loader2,
  RotateCcw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { runDownload, type DownloadJob, type DownloadState } from "@/lib/download/engine";
import { formatBytes } from "@/lib/workspace/format";
import { cn } from "@/lib/utils";

interface DownloadApi {
  /** Starts `job` and opens the dialog. Call it from the click that asked for it. */
  start: (job: DownloadJob) => void;
  /** Whether a download is under way: one at a time. */
  busy: boolean;
}

const DownloadContext = createContext<DownloadApi | null>(null);

export function useDownload(): DownloadApi {
  const api = useContext(DownloadContext);
  if (!api) throw new Error("useDownload needs a DownloadProvider");
  return api;
}

function eta(received: number, total: number, bytesPerSecond: number): string | null {
  if (bytesPerSecond <= 0) return null;
  const seconds = Math.round((total - received) / bytesPerSecond);
  if (seconds < 1) return "Almost done";
  if (seconds < 60) return `${seconds} s left`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min ${seconds % 60} s left` : `${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
}

/** How long a download may take before its dialog opens: a quick one is just saved. */
export const DIALOG_DELAY_MS = 800;
/**
 * The same for a small published file (at most `SMALL_BYTES`) read straight from S3, which a slow
 * link still takes a second or so to fetch. A download the gateway prepares (a ZIP, a NetCDF cut,
 * a file from Anvil) takes seconds before its first byte, so its dialog opens at `DIALOG_DELAY_MS`.
 */
export const SMALL_DIALOG_DELAY_MS = 3000;
export const SMALL_BYTES = 5 * 1024 * 1024;

function dialogDelay(job: DownloadJob): number {
  const bytes = job.expectedBytes;
  return job.direct && bytes != null && bytes <= SMALL_BYTES ? SMALL_DIALOG_DELAY_MS : DIALOG_DELAY_MS;
}

/**
 * Every download that is prepared or read by the page (a ZIP, a file from Anvil or from S3, a
 * NetCDF cut) shows here, the same way: when it takes longer than `dialogDelay` (longer for a
 * small file), the dialog
 * opens, says it is preparing, then shows the bytes arriving, and ends with the name of the saved
 * file. One that finishes sooner is simply saved, with no dialog; one that fails always opens it.
 * It is mounted once, in the providers; a download goes on while the page is navigated.
 */
export function DownloadProvider({ children }: { children: React.ReactNode }) {
  const [job, setJob] = useState<DownloadJob | null>(null);
  const [state, setState] = useState<DownloadState | null>(null);
  const [shown, setShown] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const shownRef = useRef(false);

  const active = state?.phase === "preparing" || state?.phase === "downloading";

  const start = useCallback(
    (next: DownloadJob, showAtOnce = false) => {
      if (abort.current && !abort.current.signal.aborted && active) return;
      const controller = new AbortController();
      abort.current = controller;
      const show = () => {
        if (abort.current !== controller) return;
        shownRef.current = true;
        setShown(true);
      };
      shownRef.current = false;
      setShown(false);
      setJob(next);
      setState({ phase: "preparing" });
      if (showAtOnce) show();
      const timer = setTimeout(show, dialogDelay(next));
      void runDownload(next, controller.signal, (s) => {
        if (abort.current !== controller) return;
        setState(s);
        if (s.phase === "failed" || s.phase === "handed-off") show();
      }).finally(() => {
        clearTimeout(timer);
        if (abort.current !== controller) return;
        // A stop reports nothing, and a quick download that was never shown needs no dialog.
        if (controller.signal.aborted || !shownRef.current) {
          setJob(null);
          setState(null);
        }
      });
    },
    [active]
  );

  const stop = () => {
    abort.current?.abort();
    setJob(null);
    setState(null);
  };

  const api = useMemo(() => ({ start: (j: DownloadJob) => start(j), busy: active }), [start, active]);

  return (
    <DownloadContext.Provider value={api}>
      {children}
      <Dialog
        open={job !== null && shown}
        onOpenChange={(open) => {
          if (!open) stop();
        }}
      >
        {job && state && (
          <DownloadDialogBody job={job} state={state} onClose={stop} onRetry={() => start(job, true)} />
        )}
      </Dialog>
    </DownloadContext.Provider>
  );
}

const STEPS = ["Prepare", "Download", "Save"] as const;

/** Which of `STEPS` a state is at: the one under way, or past the last when it is over. */
function stepOf(state: DownloadState): number {
  if (state.phase === "preparing") return 0;
  if (state.phase === "downloading") return 1;
  if (state.phase === "failed") return -1;
  return STEPS.length;
}

function FileGlyph({ filename, className }: { filename: string; className?: string }) {
  const lower = filename.toLowerCase();
  const Icon = lower.endsWith(".zip") ? FileArchive : lower.endsWith(".nc") ? FileChartColumn : FileDown;
  return <Icon className={className} aria-hidden="true" />;
}

/** The bar: its share when the total is known, else a band sliding across. */
function ProgressTrack({ percent, tone }: { percent: number | null; tone: "active" | "done" | "failed" }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      aria-label="Download progress"
      className="relative h-2 overflow-hidden rounded-full bg-muted"
    >
      {percent === null && tone === "active" ? (
        <div className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-primary/0 via-primary to-primary/0 motion-safe:animate-[download-slide_1.4s_ease-in-out_infinite]" />
      ) : (
        <div
          className={cn(
            "relative h-full overflow-hidden rounded-full transition-[width] duration-300 ease-out",
            tone === "failed" ? "bg-destructive" : tone === "done" ? "bg-success" : "bg-primary"
          )}
          style={{ width: `${tone === "done" ? 100 : (percent ?? 0)}%` }}
        >
          {tone === "active" && (
            <span className="absolute inset-0 bg-[linear-gradient(110deg,transparent_25%,rgba(255,255,255,0.35)_50%,transparent_75%)] bg-[length:200%_100%] motion-safe:animate-[download-shimmer_1.6s_linear_infinite]" />
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="truncate text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function DownloadDialogBody({
  job,
  state,
  onClose,
  onRetry,
}: {
  job: DownloadJob;
  state: DownloadState;
  onClose: () => void;
  onRetry: () => void;
}) {
  const percent =
    state.phase === "downloading" && state.total
      ? Math.min(100, Math.round((state.received / state.total) * 100))
      : null;
  const active = state.phase === "preparing" || state.phase === "downloading";
  const step = stepOf(state);
  const tone = state.phase === "failed" ? "failed" : active ? "active" : "done";
  const title =
    state.phase === "preparing"
      ? "Preparing your download"
      : state.phase === "downloading"
        ? "Downloading"
        : state.phase === "handed-off"
          ? "Your browser is saving the file"
          : state.phase === "done"
            ? "Download complete"
            : "The download failed";

  return (
    <DialogContent
      showCloseButton={!active}
      className="flex w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[460px]"
      onInteractOutside={(event) => active && event.preventDefault()}
      onEscapeKeyDown={(event) => active && event.preventDefault()}
    >
      <div className="flex min-w-0 flex-col gap-5 px-6 pt-6 pb-5">
        <DialogHeader className="min-w-0 flex-row items-center gap-3.5">
          <div
            className={cn(
              "relative flex size-12 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
              tone === "failed"
                ? "bg-destructive/10 text-destructive ring-destructive/20"
                : tone === "done"
                  ? "bg-success/10 text-success ring-success/20"
                  : "bg-primary/10 text-primary ring-primary/15"
            )}
          >
            <FileGlyph filename={job.filename} className="size-6" />
            <span
              className={cn(
                "absolute -right-1.5 -bottom-1.5 flex size-5 items-center justify-center rounded-full bg-background ring-2 ring-background",
                tone === "failed" ? "text-destructive" : tone === "done" ? "text-success" : "text-primary"
              )}
              aria-hidden="true"
            >
              {active ? (
                <Loader2 className="size-4 motion-safe:animate-spin" />
              ) : tone === "failed" ? (
                <AlertCircle className="size-4" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
            </span>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <DialogTitle className="text-base leading-tight font-semibold">{title}</DialogTitle>
            <DialogDescription className="truncate font-mono text-[12.5px]" title={job.filename}>
              {job.filename}
            </DialogDescription>
          </div>
        </DialogHeader>

        <ol className="flex min-w-0 items-center gap-2" aria-label="Steps">
          {STEPS.map((name, i) => {
            const done = step > i;
            const current = step === i;
            return (
              <li key={name} className={cn("flex min-w-0 items-center gap-2", i < STEPS.length - 1 && "flex-1")} aria-current={current ? "step" : undefined}>
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold transition-colors",
                    done
                      ? "bg-primary text-primary-foreground"
                      : current
                        ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                        : "bg-muted text-muted-foreground"
                  )}
                >
                  {done ? <Check className="size-3" aria-hidden="true" /> : i + 1}
                </span>
                <span
                  className={cn(
                    "text-xs font-medium",
                    current ? "text-foreground" : done ? "text-muted-foreground" : "text-muted-foreground/70"
                  )}
                >
                  {name}
                </span>
                {i < STEPS.length - 1 && (
                  <span className={cn("h-px min-w-3 flex-1", done ? "bg-primary/50" : "bg-border")} aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ol>

        <div role="status" aria-live="polite" className="flex min-w-0 flex-col gap-3">
          {state.phase === "downloading" && (
            <div className="flex items-end justify-between gap-3">
              <span className="text-[34px] leading-none font-semibold tracking-[-0.03em] tabular-nums">
                {percent !== null ? (
                  <>
                    {percent}
                    <span className="ml-0.5 text-lg font-medium text-muted-foreground">%</span>
                  </>
                ) : (
                  formatBytes(state.received)
                )}
              </span>
              {state.total && (
                <span className="pb-0.5 text-sm text-muted-foreground tabular-nums">
                  {formatBytes(state.received)} / {formatBytes(state.total)}
                </span>
              )}
            </div>
          )}
          {state.phase !== "handed-off" && <ProgressTrack percent={percent} tone={tone} />}

          {active && !job.direct && (
            <p className="flex gap-2 rounded-xl bg-primary/5 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-pretty text-foreground/80 ring-1 ring-primary/10 ring-inset">
              <Info className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span>
                This data has to be prepared before it can download. Keep this page open until it is saved.
              </span>
            </p>
          )}
          {state.phase === "preparing" && (
            <p className="text-[13px] leading-relaxed text-pretty text-muted-foreground">
              {job.note ??
                "The files are being read and packed before the first byte is sent. For a large download this can take a few minutes. Keep this page open."}
            </p>
          )}
          {state.phase === "downloading" && (
            <dl className="grid grid-cols-3 gap-3 rounded-xl bg-muted/50 px-4 py-3">
              <Stat label="Received" value={formatBytes(state.received)} />
              <Stat label="Speed" value={`${formatBytes(Math.round(state.bytesPerSecond))}/s`} />
              <Stat
                label="Time left"
                value={(state.total && eta(state.received, state.total, state.bytesPerSecond)?.replace(/ left$/, "")) || "—"}
              />
            </dl>
          )}
          {state.phase === "handed-off" && (
            <p className="rounded-xl bg-muted/50 px-4 py-3 text-[13px] leading-relaxed text-pretty text-muted-foreground">
              The download has started. This browser does not show its progress here: follow it in the browser&apos;s
              downloads list. You can close this window.
            </p>
          )}
          {state.phase === "done" && (
            <p className="text-[13px] text-muted-foreground">
              Saved as <span className="font-mono break-all text-foreground">{state.filename}</span>
            </p>
          )}
          {state.phase === "failed" && (
            <p className="rounded-xl bg-destructive/10 px-4 py-3 text-[13px] leading-relaxed text-pretty text-destructive">
              {state.message}
            </p>
          )}
          <p className="text-xs break-words text-muted-foreground">{job.title}</p>
        </div>
      </div>

      <DialogFooter className="border-t bg-muted/30 px-6 py-3.5">
        {active ? (
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        ) : (
          <>
            {state.phase === "failed" && (
              <Button type="button" variant="outline" onClick={onRetry}>
                <RotateCcw aria-hidden="true" />
                Try again
              </Button>
            )}
            <Button type="button" onClick={onClose}>
              {state.phase === "failed" ? "Close" : "Done"}
            </Button>
          </>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
