/**
 * Time a person reads, rendered the same on the server and in the browser.
 *
 * `toLocaleString()` in a component that renders on the server prints the
 * server's time zone and locale, then the browser prints its own: React
 * reports a hydration mismatch. So the first render (server, and the browser's
 * hydration) uses the fixed UTC formats below, and `TimeStamp` switches to the
 * viewer's own clock and zone after hydration.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `30 Sep 2026` in UTC. */
export function formatUtcDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** `30 Sep 2026, 19:04 UTC`. */
export function formatUtcDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${formatUtcDate(iso)}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** The viewer's own zone. Only call in the browser, after hydration. */
export function formatLocalDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** The viewer's own zone. Only call in the browser, after hydration. */
export function formatLocalDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** `just now`, `3 min ago`, `2 h ago`, `5 days ago`; later than `now` reads `in 3 min`. */
export function formatRelative(iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Math.round((nowMs - then) / 1000);
  const abs = Math.abs(diff);
  const future = diff < 0;
  const wrap = (text: string) => (future ? `in ${text}` : `${text} ago`);
  if (abs < 45) return future ? "in a moment" : "just now";
  if (abs < 90 * 60) return wrap(`${Math.max(1, Math.round(abs / 60))} min`);
  if (abs < 36 * 3600) return wrap(`${Math.round(abs / 3600)} h`);
  const days = Math.round(abs / 86_400);
  return wrap(`${days} ${days === 1 ? "day" : "days"}`);
}
