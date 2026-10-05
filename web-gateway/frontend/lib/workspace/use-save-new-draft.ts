"use client";

import { useCallback, useRef, useState } from "react";
import { deriveDraft, updateDraft } from "@/lib/jobs/actions";
import type { Job } from "@/lib/jobs/types";
import type { DraftContext, DraftLocal } from "@/lib/workspace/draft-state";
import {
  createNewDraftSaver,
  type SaveNewDraftDeps,
  type SaveNewDraftFailure,
  type SaveNewDraftResult,
} from "@/lib/workspace/save-new-draft";

const ACTIONS: SaveNewDraftDeps = {
  // Wrapped so that each call reads the action as it is then.
  derive: (datasetId) => deriveDraft(datasetId),
  update: (jobId, patch) => updateDraft(jobId, patch),
};

/**
 * The screen's side of saving a snapshot draft that is not stored yet
 * (`save-new-draft.ts`): one saver for the life of the wizard, so a draft that
 * was created is never created again, whichever button asked.
 *
 * - `save(local)` is for a button: one at a time (a click while one is out is
 *   ignored and answers `null`).
 * - `ensureSaved(local)` is for Submit: it joins the queue instead of being
 *   ignored.
 * - A failed create is kept in `error`, for the page to show, until the next
 *   try, whichever of the two asked.
 * - `saving` is true while either is out. `saved` is the stored draft as the
 *   server last answered once there is one, so the wizard can tell what is
 *   still unsaved from it.
 */
export function useSaveNewDraft({
  datasetId,
  ctx,
  deps = ACTIONS,
}: {
  datasetId: string;
  ctx: DraftContext;
  deps?: SaveNewDraftDeps;
}) {
  const [saver] = useState(() => createNewDraftSaver(deps));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Job | null>(null);
  const [error, setError] = useState<SaveNewDraftFailure | null>(null);
  // The state above lags a click by a render; this does not.
  const busy = useRef(false);
  const pending = useRef(0);

  const run = useCallback(
    async (local: DraftLocal): Promise<SaveNewDraftResult> => {
      pending.current += 1;
      setSaving(true);
      setError(null);
      try {
        const result = await saver.save(datasetId, local, ctx);
        if (result.ok) setSaved(result.job);
        else setError(result.failure);
        return result;
      } finally {
        pending.current -= 1;
        if (pending.current === 0) setSaving(false);
      }
    },
    [saver, datasetId, ctx]
  );

  const save = useCallback(
    async (local: DraftLocal): Promise<SaveNewDraftResult | null> => {
      if (busy.current) return null;
      busy.current = true;
      try {
        return await run(local);
      } finally {
        busy.current = false;
      }
    },
    [run]
  );

  const ensureSaved = useCallback((local: DraftLocal) => run(local), [run]);

  return { save, ensureSaved, saving, saved, error, created: saver.created };
}
