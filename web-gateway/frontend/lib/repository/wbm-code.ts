import type { CodeState, Dataset } from "@/lib/repository/types";

/**
 * What the UI says about a snapshot's WBM code. The state comes from the
 * backend (`codeState`); the policy it carries is the backend's too: a new
 * snapshot draft starts only from a snapshot on `current` code, and an
 * unreadable list of versions (`unknown`) blocks no one. This file only words
 * it and keeps the picker from offering what the server would refuse.
 */

/** Whether a new snapshot draft may start from a snapshot in this state. */
export function startsNewDraft(state: CodeState): boolean {
  return state === "current" || state === "unknown";
}

/** The chip's word for a state; `null` for the two that show nothing. */
export function codeStateLabel(state: CodeState): string | null {
  switch (state) {
    case "legacy":
      return "Legacy";
    case "withdrawn":
      return "Withdrawn";
    case "mismatch":
      return "Code mismatch";
    case "unlisted":
      return "Not listed";
    default:
      return null;
  }
}

/** The sentence behind the chip; `null` for the states that show no chip. `reason` is why a version was withdrawn. */
export function codeStateNote(state: CodeState, reason?: string | null): string | null {
  switch (state) {
    case "legacy":
      return "Legacy: runs as published; no new snapshot starts from it.";
    case "withdrawn":
      return `This WBM code was withdrawn${reason ? `: ${reason}` : " as known to be bad"}. Nothing is submitted on it.`;
    case "mismatch":
      return "Its code does not match the WBM code version it names, so it cannot be run.";
    case "unlisted":
      return "Its code is not in the list of published WBM code versions.";
    default:
      return null;
  }
}

/** Splits snapshots into the ones a new snapshot draft may start from and the ones it may not. */
export function splitByCodeState<T extends Pick<Dataset, "codeState">>(
  items: readonly T[]
): { offered: T[]; hidden: T[] } {
  const offered: T[] = [];
  const hidden: T[] = [];
  for (const item of items) (startsNewDraft(item.codeState) ? offered : hidden).push(item);
  return { offered, hidden };
}

/**
 * The one quiet line for the snapshots the picker leaves out: how many, why
 * and which versions (`onThisPage`: the list has more pages, so this is only the one shown). "Older" when every one is legacy, "no longer current"
 * when a withdrawn, unlisted or mismatched one is among them.
 */
export function hiddenSnapshotsNote(
  hidden: readonly Pick<Dataset, "codeState" | "uses">[],
  onThisPage = false
): string {
  const versions = [...new Set(hidden.map((item) => item.uses.modelCode.version))];
  const older = hidden.every((item) => item.codeState === "legacy");
  const count = hidden.length;
  return (
    `${count} model snapshot${count === 1 ? " is" : "s are"} not offered${onThisPage ? " on this page" : ""}: ` +
    `${count === 1 ? "it runs" : "they run"} on ${older ? "older" : "no longer current"} WBM code ` +
    `(${versions.join(", ")}), which no new snapshot draft starts from.`
  );
}
