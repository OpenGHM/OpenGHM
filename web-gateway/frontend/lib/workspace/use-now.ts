"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The clock, rounded down to the tick so the snapshot is stable between ticks,
 * re-read every `tickMs`. `null` on the server and while hydrating: a caller
 * prints something that does not depend on the clock until it has one, so the
 * two renders agree. The value can trail the real time by up to `tickMs`, so
 * a caller subtracting it from a recent timestamp must clamp at zero
 * (`formatAge`, `elapsedSeconds` do).
 */
export function useNow(tickMs = 1_000): number | null {
  const subscribe = useCallback(
    (onTick: () => void) => {
      const id = setInterval(onTick, tickMs);
      return () => clearInterval(id);
    },
    [tickMs]
  );
  return useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / tickMs) * tickMs,
    () => null
  );
}
