/**
 * A draft's dataset forks: a data `.init` edited as the run's own copy (ADR 0039).
 *
 * `parameters.forks` holds, per field that reads a dataset, the original and the values the copy
 * sets (`Var_Scale`, `Var_Offset`, `Units`, as text). The gateway names the copy and the run's
 * toolkit makes it; nothing here knows either. A fork with nothing to set is a repair: WBM 23.9.0
 * refuses some shipped descriptors for their `Code_Name` or a non-ASCII byte, and a copy fixes both.
 *
 * Pure rules for editing the list and for the words the Review step, the submit confirmation and
 * the job page use. Nothing here touches React or the network.
 */
import type { DatasetFork } from "@/lib/jobs/types";

export type { DatasetFork } from "@/lib/jobs/types";

/** The descriptor keys a copy may set, in the order they are shown and sent. */
export const FORK_KEYS = ["Var_Scale", "Var_Offset", "Units"] as const;
export type ForkKey = (typeof FORK_KEYS)[number];

const NUMBER_KEYS: readonly string[] = ["Var_Scale", "Var_Offset"];

/** WBM's own number form (`isNumber`): a digit before the point, so `.5` is not one. */
const WBM_NUMBER = /^[-+]?[0-9]+(\.[0-9]*)?([eE][-+]?[0-9]+(\.[0-9]*)?)?$/;

/** The backend refuses a value longer than this. */
const MAX_LENGTH = 256;

/** What `GET .../datasets/{id}/dataset-init` answers: the values of one data init of the snapshot's
 *  model input, as text (empty when the file has no such key). The Edit dataset panel shows them
 *  beside the values a copy sets. */
export interface DatasetInit {
  path: string;
  name: string;
  Code_Name: string;
  Units: string;
  Var_Scale: string;
  Var_Offset: string;
  Time_Series: string;
  Start_Date: string;
  End_Date: string;
}

export function forkAt(forks: readonly DatasetFork[] | null | undefined, path: string): DatasetFork | null {
  return forks?.find((f) => f.path === path) ?? null;
}

/** The forks sorted by field path with their values in the fixed key order, and `null` for none:
 *  two lists holding the same forks are the same text. */
export function canonicalForks(forks: readonly DatasetFork[] | null | undefined): DatasetFork[] | null {
  if (!forks || forks.length === 0) return null;
  return [...forks]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => ({
      path: f.path,
      original: f.original,
      set: Object.fromEntries(
        [...Object.keys(f.set)]
          .sort((a, b) => order(a) - order(b) || (a < b ? -1 : 1))
          .map((key) => [key, f.set[key]])
      ),
    }));
}

const order = (key: string): number => {
  const at = (FORK_KEYS as readonly string[]).indexOf(key);
  return at < 0 ? FORK_KEYS.length : at;
};

/** The list with `fork` in place of the one for its field, or added. */
export function withFork(forks: readonly DatasetFork[] | null | undefined, fork: DatasetFork): DatasetFork[] | null {
  return canonicalForks([...(forks ?? []).filter((f) => f.path !== fork.path), fork]);
}

/** The list without the fork of `path`. */
export function withoutFork(forks: readonly DatasetFork[] | null | undefined, path: string): DatasetFork[] | null {
  return canonicalForks((forks ?? []).filter((f) => f.path !== path));
}

/** The list without the forks of any of `paths`. */
export function withoutForks(
  forks: readonly DatasetFork[] | null | undefined,
  paths: readonly string[]
): DatasetFork[] | null {
  const gone = new Set(paths);
  return canonicalForks((forks ?? []).filter((f) => !gone.has(f.path)));
}

/** The paths of the forks. */
export const forkPaths = (forks: readonly DatasetFork[] | null | undefined): string[] =>
  (forks ?? []).map((f) => f.path);

/** The message for one value of a copy, as the backend would give it, or null when it is fine. The
 *  backend decides; this is only so the panel can say it as the person types. */
export function forkValueProblem(key: ForkKey, value: string): string | null {
  const text = value.trim();
  if (text === "") return null; // not set: the original's value stays
  if (!/^[\x20-\x7e]*$/.test(value)) {
    return key === "Units" && /[\x00-\x1f\x7f]/.test(value)
      ? "Units must be a single line of text."
      : "Use ASCII characters only: WBM cannot read anything else.";
  }
  if (value.length > MAX_LENGTH) return `At most ${MAX_LENGTH} characters.`;
  if (!NUMBER_KEYS.includes(key)) return null;
  if (!WBM_NUMBER.test(text)) return "Use a number like 1.1 or 2e-3.";
  const number = Number(text);
  if (!Number.isFinite(number)) return "The number is too large.";
  if (key === "Var_Scale" && number === 0) return "WBM reads a Var_Scale of 0 as 1, so it cannot be used.";
  return null;
}

/** The file name of a data init path. */
export const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** What a copy sets, as the lists read it: `Var_Scale 1.1, Units mm/day`. */
export function describeSet(set: Readonly<Record<string, string>>): string {
  return Object.keys(set)
    .sort((a, b) => order(a) - order(b))
    .map((key) => `${key} ${set[key]}`)
    .join(", ");
}

/** The line a fork has in the Review step, the submit confirmation and the job page: the original
 *  it copies and what it sets (`copy of merra2_prectotcorr_d.init, Var_Scale 1.1`); a copy that sets
 *  nothing says it repairs. */
export function forkSummary(fork: DatasetFork): string {
  const what = describeSet(fork.set);
  return `copy of ${fileName(fork.original)}${what ? `, ${what}` : " (repaired)"}`;
}
