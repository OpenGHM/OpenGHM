/** How many characters of the one-line summary an audit row shows before it folds. */
const SUMMARY_MAX = 90;

/** One scalar or nested value as text: a string as it is, anything else as JSON. */
function show(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return String(value);
  return JSON.stringify(value);
}

/** An event's detail as `key: value` text, in the order the backend wrote it. */
export function detailPairs(detail: Record<string, unknown> | null): string[] {
  if (!detail) return [];
  return Object.entries(detail).map(([key, value]) => `${key}: ${show(value)}`);
}

export interface DetailView {
  /** The pairs on one line, cut at `SUMMARY_MAX` with an ellipsis. */
  summary: string;
  /** True when the summary lost something (it was cut, or a value is itself an object), so the full JSON is worth opening. */
  expandable: boolean;
  /** The whole detail, indented. */
  json: string;
}

/** What an audit row prints for its detail; `null` when the event has none. */
export function detailView(detail: Record<string, unknown> | null): DetailView | null {
  if (!detail || Object.keys(detail).length === 0) return null;
  const full = detailPairs(detail).join(" · ");
  const nested = Object.values(detail).some((v) => v !== null && typeof v === "object");
  const cut = full.length > SUMMARY_MAX;
  return {
    summary: cut ? `${full.slice(0, SUMMARY_MAX - 1)}…` : full,
    expandable: cut || nested,
    json: JSON.stringify(detail, null, 2),
  };
}
