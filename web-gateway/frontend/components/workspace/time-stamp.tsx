"use client";

import { useSyncExternalStore } from "react";
import {
  formatLocalDate,
  formatLocalDateTime,
  formatRelative,
  formatUtcDate,
  formatUtcDateTime,
} from "@/lib/workspace/time";

const TICK_MS = 30_000;

function subscribe(onTick: () => void) {
  const id = setInterval(onTick, TICK_MS);
  return () => clearInterval(id);
}

/** The clock, rounded to the tick so the snapshot is stable between ticks.
 *  `null` on the server and while hydrating. */
function useTick(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / TICK_MS) * TICK_MS,
    () => null
  );
}

/**
 * A moment in time that does not cause a hydration mismatch. The server and
 * the first client render print it in UTC; after hydration it switches to the
 * viewer's own zone. Relative time ("3 min ago") carries the absolute time in
 * a tooltip (`title`).
 */
export function TimeStamp({
  value,
  format = "datetime",
  className,
}: {
  value: string;
  /** `relative`: "3 min ago", tooltip holds the date and time. `datetime` and
   *  `date`: the absolute time itself. */
  format?: "relative" | "datetime" | "date";
  className?: string;
}) {
  const now = useTick();
  const hydrated = now !== null;

  const absolute = hydrated
    ? format === "date"
      ? formatLocalDate(value)
      : formatLocalDateTime(value)
    : format === "date"
      ? formatUtcDate(value)
      : formatUtcDateTime(value);

  const text = format === "relative" && hydrated ? formatRelative(value, now) : absolute;

  return (
    <time
      dateTime={value}
      title={format === "relative" ? absolute : undefined}
      className={className}
    >
      {text}
    </time>
  );
}
