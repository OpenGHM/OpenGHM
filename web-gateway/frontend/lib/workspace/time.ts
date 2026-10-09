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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date with no time, exactly `YYYY-MM-DD` (`about.datePublished`).
 *  It names a day, not a moment: `new Date("2022-02-23")` is UTC midnight, so
 *  converting it to a zone west of UTC would print 22 Feb. The date formats
 *  below therefore read it in UTC whatever zone they were asked for. */
export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value) && !Number.isNaN(new Date(value).getTime());
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

/** The viewer's own zone, except a date-only value, which is the same day
 *  everywhere. Only call in the browser, after hydration. */
export function formatLocalDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(isDateOnly(iso) && { timeZone: "UTC" }),
  });
}

/** `February 23, 2022`, for a detail page. A date-only value is the same day
 *  in every zone; a full timestamp is read in the zone the code runs in. */
export function formatLongDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(isDateOnly(iso) && { timeZone: "UTC" }),
  });
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

/** `just now`, `3 min ago`, `2 h ago`, `5 days ago`; later than `now` reads `in 3 min`.
 *
 *  `nowMs` is often a clock rounded down to a tick (`TimeStamp` ticks every
 *  30 s), so it can trail the real time by up to a tick and make an event that
 *  just happened look like it is in the future. `toleranceMs` is that tick: a
 *  time that far ahead or less is taken as now, never as `in a moment`. A time
 *  really ahead (SLURM's estimated start) is further off than the tick. */
export function formatRelative(iso: string, nowMs: number, toleranceMs = 0): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  if (then - nowMs > 0 && then - nowMs <= toleranceMs) return "just now";
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

/** How old something is, to the second while it is young: `5 s ago`,
 *  `3 min ago`, `2 h ago`. For a freshness line that ticks each second;
 *  `formatRelative` is for moments that are hours or days old. */
export function formatAge(ageMs: number): string {
  const s = Math.max(0, Math.floor(ageMs / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

/** A length of time: `42 s`, `4 min 12 s`, `1 h 5 min 3 s`. Zero parts are
 *  dropped after the first; `withSeconds: false` rounds down to the minute
 *  (`23 min`), for a limit rather than a stopwatch. Hours are not folded into
 *  days: a 96 h walltime reads `96 h`. */
export function formatDuration(totalSeconds: number, { withSeconds = true } = {}): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} h`);
  if (m > 0) parts.push(`${m} min`);
  if (withSeconds && (s > 0 || parts.length === 0)) parts.push(`${s} s`);
  if (parts.length === 0) parts.push("0 min");
  return parts.join(" ");
}

/** `3:33 AM` in the viewer's zone, with the date (`Oct 4, 1:10 AM`) when
 *  `sameDayAs` is given and the moment falls on another day. Only call in the
 *  browser, after hydration. */
export function formatLocalTime(iso: string, sameDayAs?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDayAs) {
    const ref = new Date(sameDayAs);
    if (!Number.isNaN(ref.getTime()) && ref.toDateString() !== d.toDateString()) {
      const day = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      return `${day}, ${time}`;
    }
  }
  return time;
}

/** `19:04 UTC`, or `1 Oct, 19:04 UTC` on another UTC day than `sameDayAs`:
 *  what `formatLocalTime` falls back to before hydration. */
export function formatUtcTime(iso: string, sameDayAs?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
  if (sameDayAs) {
    const ref = new Date(sameDayAs);
    if (!Number.isNaN(ref.getTime()) && ref.toISOString().slice(0, 10) !== d.toISOString().slice(0, 10)) {
      return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${time}`;
    }
  }
  return time;
}

/** The viewer's zone as the browser names it at that moment (`GMT+9`, `PDT`).
 *  Only call in the browser, after hydration. Empty when the browser gives none. */
export function localZoneName(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (
    new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(d)
      .find((part) => part.type === "timeZoneName")?.value ?? ""
  );
}
