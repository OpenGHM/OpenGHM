/**
 * The words and the arithmetic of acting on several rows of a Community admin
 * list: what a selection amounts to, how a list of names reads in a dialog,
 * and what a bulk answer is called in a toast.
 */
import type { ActionFailure } from "@/lib/jobs/types";
import type { BulkResult, ContentKind } from "@/lib/community/types";

/** What the things in a list are called, as a bulk message says them. */
export type Noun = ContentKind | "files";

const NOUNS: Record<Noun, [one: string, many: string]> = {
  workshops: ["workshop", "workshops"],
  tutorials: ["tutorial", "tutorials"],
  publications: ["publication", "publications"],
  news: ["news post", "news posts"],
  files: ["file", "files"],
};

/** "workshop" for one, "workshops" for any other count. */
export function nounFor(noun: Noun, count: number): string {
  return NOUNS[noun][count === 1 ? 0 : 1];
}

/** The state of a select-all checkbox: all, some (indeterminate) or none of the rows. */
export function selectionState(total: number, selected: number): boolean | "indeterminate" {
  if (total > 0 && selected >= total) return true;
  return selected > 0 ? "indeterminate" : false;
}

/** “A”, “B”, “C” and 2 more: the names a dialog lists, at most `max` of them. */
export function nameList(names: readonly string[], max = 3): string {
  const shown = names.slice(0, max).map((name) => `“${name}”`);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(", ")} and ${rest} more`;
  if (shown.length > 1) return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return shown[0] ?? "";
}

/** What a refused bulk request says. */
export function bulkFailure(failure: ActionFailure, doing: string): string {
  if (failure.reason === "session_expired") return "Your session has expired. Sign in again.";
  if (failure.reason === "not_found") return `Couldn't ${doing}: the service doesn't have that. Reload the page and try again.`;
  return failure.message;
}

/** How a state change reads in a toast once the backend has answered. An id the
 *  backend no longer has is a failure: say which ones, so the admin can look. */
export function stateChangeSummary(
  noun: Noun,
  state: "published" | "draft",
  result: BulkResult,
  titles: ReadonlyMap<string, string>
): { ok: boolean; message: string } {
  const done = result.done.length;
  const what = `${done} ${nounFor(noun, done)}`;
  const did = state === "published" ? `Published ${what}` : `Moved ${what} to draft`;
  if (result.missing.length === 0) return { ok: true, message: `${did}.` };
  const names = nameList(result.missing.map((id) => titles.get(id) ?? id));
  const gone = `${names} no longer ${result.missing.length === 1 ? "exists" : "exist"}. Reload the page.`;
  return { ok: false, message: done === 0 ? `Nothing was changed: ${gone}` : `${did}, but ${gone}` };
}
