"use client";

import { useEffect, useState } from "react";
import { fetchModelInputById } from "@/lib/repository/actions";
import type { Dataset, ModelInput } from "@/lib/repository/types";

/**
 * The model input a draft will run against: its own override, else the one the
 * snapshot cites. Null when there is neither (no override, and the snapshot
 * could not be loaded), which `useCatalogueModelInput` answers with null.
 */
export function effectiveModelInputId(
  override: string | null,
  snapshot: Dataset | null
): string | null {
  return override ?? snapshot?.uses.modelInput.id ?? null;
}

/**
 * Whether the model-inputs catalogue holds a model input: the same lookup the
 * backend makes once a draft exists (`_resolve_effective_model_input`,
 * app/api/v1/jobs.py). `undefined` is still looking, `null` is not held (or
 * there is no id, or the lookup failed), a `ModelInput` is found.
 *
 * It is display only: a simulation fetches the snapshot's model input by its id and
 * never reads the catalogue. The draft wizard calls this once, so that step 2
 * and the review step say the same thing.
 */
export function useCatalogueModelInput(id: string | null): ModelInput | null | undefined {
  // Kept with the id it answers, so a different id reads as "looking" without
  // resetting state inside the effect.
  const [answer, setAnswer] = useState<{ id: string; found: ModelInput | null } | null>(null);

  useEffect(() => {
    if (id === null) return;
    let cancelled = false;
    fetchModelInputById(id)
      .then((found) => {
        if (!cancelled) setAnswer({ id, found });
      })
      .catch(() => {
        if (!cancelled) setAnswer({ id, found: null });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (id === null) return null;
  return answer?.id === id ? answer.found : undefined;
}
