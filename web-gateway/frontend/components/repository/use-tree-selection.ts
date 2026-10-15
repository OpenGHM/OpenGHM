"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FolderSize } from "@/lib/repository/selection";
import { folderSummaryRoute } from "@/lib/repository/tree-browse";
import type { FolderSummary, TreeKind } from "@/lib/repository/types";

const NONE: string[] = [];

/**
 * The entries ticked in the folder being viewed, by name (a folder's ends with
 * `/`), in the order they were ticked. They belong to the folder: another one
 * opened starts with nothing ticked.
 *
 * A ticked folder's size is asked of the gateway (`GET …/files/folder`, a route
 * rather than a server action: a big folder takes seconds to total, and server
 * actions run one at a time, so it would hold up the next listing) and kept by
 * path for as long as the hook lives, which is as long as the view is open: a
 * published tree does not change, so a folder is asked about once. Until a
 * folder's answer comes, `sizes` has no entry for it.
 */
export function useTreeSelection(kind: TreeKind, id: string, folder: string) {
  const [selection, setSelection] = useState({ folder, names: [] as string[] });
  // Opening another folder clears the selection: set during render, not after it,
  // so that the new folder is never shown with the old one's ticks.
  if (selection.folder !== folder) setSelection({ folder, names: [] });
  const names = selection.folder === folder ? selection.names : NONE;

  const set = useCallback((next: (names: string[]) => string[]) => {
    setSelection((prev) => ({ folder, names: next(prev.folder === folder ? prev.names : []) }));
  }, [folder]);
  const toggle = useCallback(
    (name: string) => set((cur) => (cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name])),
    [set]
  );
  const setAll = useCallback((all: string[]) => set(() => all), [set]);
  const clear = useCallback(() => set(() => []), [set]);

  const [answers, setAnswers] = useState<Record<string, FolderSize>>({});
  const [attempt, setAttempt] = useState(0);
  const requested = useRef(new Set<string>());

  useEffect(() => {
    for (const name of names) {
      const path = `${folder}${name}`;
      if (!name.endsWith("/") || requested.current.has(path)) continue;
      requested.current.add(path);
      const fail = () => {
        requested.current.delete(path);
        setAnswers((prev) => ({ ...prev, [path]: { status: "failed" } }));
      };
      fetch(folderSummaryRoute(kind, id, path)).then(async (response) => {
        if (!response.ok) return fail();
        try {
          const summary = (await response.json()) as FolderSummary;
          setAnswers((prev) => ({ ...prev, [path]: { status: "ready", summary } }));
        } catch {
          fail();
        }
      }, fail);
    }
    // `attempt` only runs this again after a retry has cleared `requested`.
  }, [kind, id, folder, names, attempt]);

  const retry = useCallback(
    (name: string) => {
      const path = `${folder}${name}`;
      requested.current.delete(path);
      setAnswers((prev) => {
        const rest = { ...prev };
        delete rest[path];
        return rest;
      });
      setAttempt((a) => a + 1);
    },
    [folder]
  );

  // By entry name, for the selection's totals.
  const sizes: Record<string, FolderSize | undefined> = {};
  for (const name of names) sizes[name] = answers[`${folder}${name}`];
  return { names, sizes, toggle, setAll, clear, retry };
}

export type TreeSelection = ReturnType<typeof useTreeSelection>;
