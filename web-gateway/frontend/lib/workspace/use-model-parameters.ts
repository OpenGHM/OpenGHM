"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchModelParameters } from "@/lib/repository/actions";
import { isInitUnavailable, type ModelParameters } from "@/lib/workspace/model-parameters";

/**
 * What the wizard knows about the parameter tree of the draft's snapshot.
 *
 * - `loading`: asked, not answered yet.
 * - `ready`: the tree, resolved for the snapshot's WBM version.
 * - `unavailable`: the snapshot has none to show (it is not a snapshot, or its
 *   init could not be read: 503 `init_unavailable`). A different draft of it
 *   asks again, and an answer is not kept.
 * - `error`: the call itself failed; `message` is safe to show.
 *
 * Nothing else in the wizard waits for it.
 */
export type ModelParametersState =
  | { status: "loading" }
  | { status: "ready"; tree: ModelParameters }
  | { status: "unavailable" }
  | { status: "error"; message: string };

type Settled = Exclude<ModelParametersState, { status: "loading" }>;

/** A tree is a fact about a published snapshot and a code version, so a tree
 *  that was read is kept for the page's life: going back to Run settings, or
 *  opening another draft of the same snapshot, does not ask again. */
const kept = new Map<string, ModelParameters>();

/** For tests. */
export function forgetModelParameters(): void {
  kept.clear();
}

async function load(datasetId: string): Promise<Settled> {
  const hit = kept.get(datasetId);
  if (hit) return { status: "ready", tree: hit };
  try {
    const result = await fetchModelParameters(datasetId);
    if (result.ok) {
      kept.set(datasetId, result.data);
      return { status: "ready", tree: result.data };
    }
    if (result.reason === "not_found") return { status: "unavailable" };
    if (result.reason === "session_expired") {
      return { status: "error", message: "Your session ended. Sign in again to see the model parameters." };
    }
    if (isInitUnavailable(result)) return { status: "unavailable" };
    return { status: "error", message: result.message };
  } catch {
    return { status: "error", message: "Couldn't load the model parameters." };
  }
}

/**
 * Loads the parameter tree for a snapshot once, as the wizard opens, and again
 * on `retry()`. An answer that arrives after the id changed is dropped.
 */
export function useModelParameters(datasetId: string): {
  state: ModelParametersState;
  retry: () => void;
} {
  const [round, setRound] = useState(0);
  // Kept with the question it answers, so a different id or a retry reads as
  // "loading" without resetting state inside the effect.
  const [settled, setSettled] = useState<{ datasetId: string; round: number; state: Settled } | null>(null);

  useEffect(() => {
    let live = true;
    void load(datasetId).then((state) => {
      if (live) setSettled({ datasetId, round, state });
    });
    return () => {
      live = false;
    };
  }, [datasetId, round]);

  const retry = useCallback(() => setRound((n) => n + 1), []);
  const state: ModelParametersState =
    settled && settled.datasetId === datasetId && settled.round === round
      ? settled.state
      : (() => {
          const hit = kept.get(datasetId);
          return hit ? { status: "ready" as const, tree: hit } : { status: "loading" as const };
        })();
  return { state, retry };
}
