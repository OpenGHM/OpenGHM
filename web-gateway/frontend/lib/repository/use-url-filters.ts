"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Treats the URL as the source of truth for a filtered/sorted/paginated
 * list — the fix for open item 16 (`repository-client.tsx` and its
 * model-input sibling kept filters in `useState` only, so a shared link
 * rendered unfiltered and the back button did nothing).
 *
 * Two directions, both driven off the same `URLSearchParams`:
 *  - a local edit debounces into `router.push` (so the back button steps
 *    through *committed* searches, not every keystroke) and refetches;
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
}: {
  initialFilters: F;
  initialResult: R;
  emptyResult: R;
  parse: (params: URLSearchParams) => F;
  serialize: (filters: F) => URLSearchParams;
  fetcher: (filters: F) => Promise<R>;
  debounceMs?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filters, setFiltersState] = useState<F>(initialFilters);
  const [result, setResult] = useState<R>(initialResult);
  const [isPending, startTransition] = useTransition();

  // The query string of the last URL *we* pushed — lets the external-change
  // effect below tell "we caused this" apart from "the user/browser did."
  const lastPushedQuery = useRef(searchParams.toString());
  const isFirstRender = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doFetch = useCallback(
    (f: F) => {
      startTransition(async () => {
        try {
          setResult(await fetcher(f));
        } catch {
          setResult(emptyResult);
        }
      });
    },
    [fetcher, emptyResult]
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
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      doFetch(filters);
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
    doFetch(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const setFilters = useCallback((updates: Partial<F>) => {
    setFiltersState((prev) => {
      const next = { ...prev, ...updates };
      // Reset to page 1 on any filter change except an explicit page change.
      if (!("page" in updates)) {
        (next as Record<string, unknown>).page = 1;
      }
      return next;
    });
  }, []);

  return { filters, setFilters, result, isPending };
}
