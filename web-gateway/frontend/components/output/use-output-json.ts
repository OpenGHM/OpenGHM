"use client";

import { useEffect, useState } from "react";
import { describeProblem, type OutputProblem } from "@/lib/output/view";

export interface Loaded<T> {
  /** The last answer for any url; it stays while the next is on its way, so an image is not blanked between steps. */
  data: T | null;
  /** The url `data` was read for. */
  dataUrl: string | null;
  loading: boolean;
  problem: OutputProblem | null;
}

interface Internal<T> {
  url: string | null;
  data: T | null;
  dataUrl: string | null;
  problem: OutputProblem | null;
  done: boolean;
}

/**
 * GET `url` as JSON, or nothing for `null`. Each url has one request, and one
 * superseded (the url changed, or the card went away) is aborted, so a slow
 * answer for a date already left can never overwrite the one on screen.
 */
export function useOutputJson<T>(url: string | null, retry = 0): Loaded<T> {
  const [state, setState] = useState<Internal<T>>({ url: null, data: null, dataUrl: null, problem: null, done: true });

  useEffect(() => {
    if (url === null) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (response.ok && body !== null) {
          setState({ url, data: body as T, dataUrl: url, problem: null, done: true });
        } else {
          setState((s) => ({ url, data: s.data, dataUrl: s.dataUrl, problem: describeProblem(response.status, body), done: true }));
        }
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        setState((s) => ({
          url,
          data: s.data,
          dataUrl: s.dataUrl,
          problem: { kind: "error", message: "The gateway could not be reached. Try again in a moment." },
          done: true,
        }));
      }
    })();
    return () => controller.abort();
  }, [url, retry]);

  if (url === null) return { data: null, dataUrl: null, loading: false, problem: null };
  const current = state.url === url && state.done;
  return {
    data: state.data,
    dataUrl: state.dataUrl,
    loading: !current,
    problem: current ? state.problem : null,
  };
}
