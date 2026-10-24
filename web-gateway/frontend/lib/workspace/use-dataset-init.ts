"use client";

import { useEffect, useState } from "react";
import { fetchDatasetInit } from "@/lib/repository/actions";
import type { DatasetInit } from "@/lib/workspace/dataset-forks";

/**
 * What the Edit dataset panel knows about the original it copies.
 *
 * - `loading`: asked, not answered yet.
 * - `ready`: the original's values.
 * - `error`: the model input could not be read or does not have the file; `message` is safe to show.
 *
 * Nothing else in the panel waits for it: the values the draft sets can be typed before it arrives.
 */
export type DatasetInitState =
  | { status: "loading" }
  | { status: "ready"; init: DatasetInit }
  | { status: "error"; message: string };

type Settled = Exclude<DatasetInitState, { status: "loading" }>;

/** A published model input does not change under its id, so a descriptor that was read is kept
 *  for the page's life, by snapshot and path. */
const kept = new Map<string, DatasetInit>();
const key = (datasetId: string, path: string) => `${datasetId}\u0000${path}`;

/** For tests. */
export function forgetDatasetInits(): void {
  kept.clear();
}

async function load(datasetId: string, path: string): Promise<Settled> {
  const hit = kept.get(key(datasetId, path));
  if (hit) return { status: "ready", init: hit };
  try {
    const result = await fetchDatasetInit(datasetId, path);
    if (result.ok) {
      kept.set(key(datasetId, path), result.data);
      return { status: "ready", init: result.data };
    }
    if (result.reason === "session_expired") {
      return { status: "error", message: "Your session ended. Sign in again to see the original's values." };
    }
    if (result.reason === "not_found") {
      return { status: "error", message: "The model input does not have this dataset." };
    }
    return { status: "error", message: result.message };
  } catch {
    return { status: "error", message: "Couldn't load the original's values." };
  }
}

/**
 * Loads the descriptor of the dataset a field reads, when `enabled` (the panel is open), and
 * again when the path changes. An answer that arrives after the path changed is dropped.
 */
export function useDatasetInit(datasetId: string, path: string, enabled: boolean): DatasetInitState {
  const [settled, setSettled] = useState<{ id: string; path: string; state: Settled } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void load(datasetId, path).then((state) => {
      if (live) setSettled({ id: datasetId, path, state });
    });
    return () => {
      live = false;
    };
  }, [datasetId, path, enabled]);

  if (settled && settled.id === datasetId && settled.path === path) return settled.state;
  const hit = kept.get(key(datasetId, path));
  return hit ? { status: "ready", init: hit } : { status: "loading" };
}
