import { useEffect, useState } from "react";

/**
 * `flag`, but only once it has been true for `delayMs`. Turning false resets it
 * at once. For feedback that should appear only when a wait is long enough to
 * notice: a request that ends inside the delay never shows it.
 */
export function useDelayedFlag(flag: boolean, delayMs = 300): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!flag) return;
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => {
      clearTimeout(timer);
      setElapsed(false);
    };
  }, [flag, delayMs]);

  return flag && elapsed;
}
