/**
 * What the running card prints: time against the walltime, and how far WBM has
 * simulated (ADR 0027). Pure, so the words and the thresholds are tested.
 */
import type { JobProgress } from "@/lib/jobs/types";

/** Whole seconds from `startIso` to `nowMs`, never negative (the browser's
 *  clock may be a little behind SLURM's). `null` when the start is unreadable. */
export function elapsedSeconds(startIso: string | null, nowMs: number): number | null {
  if (!startIso) return null;
  const start = new Date(startIso).getTime();
  if (Number.isNaN(start)) return null;
  return Math.max(0, Math.floor((nowMs - start) / 1000));
}

export type WalltimeTone = "normal" | "warning" | "critical";

/** Share of the walltime used, 0 to 100, and how alarming it is: amber from
 *  80 %, red from 95 %. `null` without a limit. */
export function walltimeUsed(
  elapsed: number,
  limitSeconds: number | null
): { percent: number; tone: WalltimeTone } | null {
  if (!limitSeconds || limitSeconds <= 0) return null;
  const percent = Math.min(100, Math.max(0, (elapsed / limitSeconds) * 100));
  const tone = percent >= 95 ? "critical" : percent >= 80 ? "warning" : "normal";
  return { percent, tone };
}

export interface ProgressWords {
  /** The line above the bar. */
  headline: string;
  /** 0 to 100 for a determinate bar; `null` when there is no percentage. */
  percent: number | null;
  /** Muted explanation under it. */
  note: string | null;
}

/** The words for WBM's progress; `null` progress says it has not reported. */
export function describeProgress(progress: JobProgress | null): ProgressWords {
  if (!progress) {
    return { headline: "", percent: null, note: "WBM hasn't reported a simulated date yet." };
  }
  if (progress.phase === "spinup") {
    const which =
      progress.loop !== null && progress.loops !== null
        ? `Spin-up ${progress.loop} of ${progress.loops}`
        : "Spin-up";
    return {
      headline: `${which} · simulating ${progress.date}`,
      percent: null,
      note: "Spin-up length isn't reported, so no percentage.",
    };
  }
  const range =
    progress.run_start && progress.run_end ? ` · run ${progress.run_start} → ${progress.run_end}` : "";
  if (progress.fraction === null) {
    return { headline: `Simulating ${progress.date}${range}`, percent: null, note: null };
  }
  const percent = Math.round(Math.min(1, Math.max(0, progress.fraction)) * 100);
  return { headline: `Simulating ${progress.date}${range} · ${percent} %`, percent, note: null };
}
