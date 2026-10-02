"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Treats the URL as the source of truth for a filtered/sorted/paginated
 * list — the fix for open item 16 (`repository-client.tsx` and its
 * model-input sibling kept filters in `useState` only, so a shared link
 * rendered unfiltered and the back button did nothing).
 *
 * Two directions, both driven off the same `URLSearchParams`:
 *  - a local edit debounces into a `history.pushState` (so the back button
 *    steps through *committed* searches, not every keystroke) and refetches.
 *    Not `router.push`: that would render the server page again for a result
 *    the client throws away, because it keeps its own. Next's router follows a
 *    native pushState, so `useSearchParams` and `usePathname` see the new URL.
 *  - an external URL change — back/forward navigation, or a link someone
 *    pasted — is told apart from our own push via `lastPushedQuery`, and
 *    resyncs local state + refetches without pushing again (which would
 *    turn "back" into "forward" on the next render).
 */
export function useUrlSyncedFilters<F extends object, R>({
  initialFilters,
  initialResult,
  emptyResult,
  parse,
  serialize,
  fetcher,
  debounceMs = 300,
  initialError = false,
  inertKeys,
}: {
  initialFilters: F;
  initialResult: R;
  emptyResult: R;
  parse: (params: URLSearchParams) => F;
  serialize: (filters: F) => URLSearchParams;
  fetcher: (filters: F) => Promise<R>;
  debounceMs?: number;
  /** The server render could not fetch `initialResult`: start in the error state. */
  initialError?: boolean;
  /**
   * Filter keys that live in the URL but do not change the result, such as a
   * list/grid view. Changing only these keys neither goes back to page 1 nor
   * fetches again.
   */
  inertKeys?: readonly (keyof F)[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filters, setFiltersState] = useState<F>(initialFilters);
  const [result, setResult] = useState<R>(initialResult);
  // True when the last fetch failed; `result` is then `emptyResult`. A caller
  // that only wants "no results" can ignore it, as the snapshot picker does.
  const [error, setError] = useState(initialError);
  const [isPending, startTransition] = useTransition();

  // The query string of the last URL *we* pushed — lets the external-change
  // effect below tell "we caused this" apart from "the user/browser did."
  const lastPushedQuery = useRef(searchParams.toString());
  const isFirstRender = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // What the last fetch was asked: the filters without the inert keys.
  const fetchKey = useCallback(
    (f: F) => JSON.stringify(f, (k, v) => (inertKeys?.includes(k as keyof F) ? undefined : v)),
    [inertKeys]
  );
  const lastFetchKey = useRef(fetchKey(initialFilters));

  const doFetch = useCallback(
    (f: F) => {
      lastFetchKey.current = fetchKey(f);
      startTransition(async () => {
        try {
          setResult(await fetcher(f));
          setError(false);
        } catch {
          setResult(emptyResult);
          setError(true);
        }
      });
    },
    [fetcher, emptyResult, fetchKey]
  );

  // Local edit → debounce → push to the URL → fetch.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const qs = serialize(filters).toString();
      lastPushedQuery.current = qs;
      // A native pushState always adds an entry, even for the URL we are at:
      // after back/forward the resynced filters would push it again and end the
      // forward history. So push only a URL that differs.
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (url !== window.location.pathname + window.location.search) {
        window.history.pushState(null, "", url);
      }
      if (fetchKey(filters) !== lastFetchKey.current) doFetch(filters);
    }, debounceMs);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // External URL change (back/forward, a pasted link) → resync + fetch,
  // without pushing again.
  useEffect(() => {
    const current = searchParams.toString();
    if (current === lastPushedQuery.current) return;
    lastPushedQuery.current = current;
    const next = parse(searchParams);
    setFiltersState(next);
    if (fetchKey(next) !== lastFetchKey.current) doFetch(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const setFilters = useCallback((updates: Partial<F>) => {
    setFiltersState((prev) => {
      const next = { ...prev, ...updates };
      // Reset to page 1 on any filter change except an explicit page change
      // or a change to inert keys only.
      const onlyInert = Object.keys(updates).every((k) => inertKeys?.includes(k as keyof F));
      if (!("page" in updates) && !onlyInert) {
        (next as Record<string, unknown>).page = 1;
      }
      return next;
    });
  }, [inertKeys]);

  /** Fetch the current filters again, e.g. from a Retry button. */
  const retry = useCallback(() => doFetch(filters), [doFetch, filters]);

  return { filters, setFilters, result, isPending, error, retry };
}
