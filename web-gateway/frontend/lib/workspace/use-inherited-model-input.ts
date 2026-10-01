"use client";

import { useEffect, useState } from "react";
import { fetchModelInputById } from "@/lib/repository/actions";
import type { ModelInput } from "@/lib/repository/types";

/**
 * Whether the model-inputs catalogue holds the model input a base snapshot
 * cites: the same lookup the backend makes once a draft exists
 * (`_resolve_effective_model_input`, app/api/v1/jobs.py). `undefined` is still
 * looking, `null` is not held (or the lookup failed), a `ModelInput` is found.
 *
 * It is display only: a run fetches the snapshot's model input by its id and
 * never reads the catalogue. The wizard calls this once, so that step 2 and the
 * review step say the same thing.
 */
export function useInheritedModelInput(inheritedId: string): ModelInput | null | undefined {
  // Kept with the id it answers, so a different id reads as "looking" without
  // resetting state inside the effect.
  const [answer, setAnswer] = useState<{ id: string; found: ModelInput | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchModelInputById(inheritedId)
      .then((found) => {
        if (!cancelled) setAnswer({ id: inheritedId, found });
      })
      .catch(() => {
        if (!cancelled) setAnswer({ id: inheritedId, found: null });
      });
    return () => {
      cancelled = true;
    };
  }, [inheritedId]);

  return answer?.id === inheritedId ? answer.found : undefined;
}
