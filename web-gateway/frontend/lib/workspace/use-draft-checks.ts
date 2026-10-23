"use client";

import { useEffect, useState } from "react";
import { draftChecks } from "@/lib/jobs/actions";
import type { CheckFinding, JobParameters } from "@/lib/jobs/types";

/**
 * What the wizard knows about the rules a submit of the draft on screen would check
 * (`draftChecks`).
 *
 * - `none`: nothing is known: the Review step is not showing and nothing was asked for
 *   these parameters, or the draft says too little to ask about.
 * - `loading`: asked, not answered yet.
 * - `ready`: the answer. `filesChecked` is false when the dataset files could not be read, so
 *   coverage was not judged (a warning says so).
 * - `error`: the check itself failed (the backend, the network, a session that ended). Never a
 *   reason to stop a submit: the submit asks the same questions and says what it refuses.
 */
export type DraftChecksState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "ready"; errors: CheckFinding[]; warnings: CheckFinding[]; filesChecked: boolean }
  | { status: "error" };

type Settled = Extract<DraftChecksState, { status: "ready" | "error" | "none" }>;

/** The draft says enough to ask about: a start and an end. Anything less is the wizard's own
 *  problem to flag. */
function askable(parameters: JobParameters): boolean {
  return !!parameters.temporal_range_start && !!parameters.temporal_range_end;
}

/**
 * Asks the backend which rules the draft's parameters fail, for the parameters on screen,
 * saved or not.
 *
 * One request per distinct question while `enabled` (the Review step is showing): the answer is
 * kept for as long as the wizard lives, so going back to Run settings and returning with the same
 * parameters does not ask again, and a change of period, variables or model parameters does.
 * What was asked for the parameters now on screen is returned even while `enabled` is off, so
 * Run settings can show it beside the fields it concerns; once they change it is gone. An answer
 * that arrives after the question has changed is dropped.
 */
export function useDraftChecks({
  datasetId,
  parameters,
  enabled,
}: {
  datasetId: string;
  parameters: JobParameters;
  enabled: boolean;
}): DraftChecksState {
  // The question as one string: the effect depends on what is asked, not on the identity of an
  // object that is rebuilt on every keystroke elsewhere.
  const key = askable(parameters) ? JSON.stringify({ datasetId, parameters }) : null;
  const [settled, setSettled] = useState<{ key: string; state: Settled } | null>(null);

  useEffect(() => {
    if (!enabled || key === null) return;
    // Held in the cache already: nothing to ask. A failed check is asked again the next time
    // Review shows.
    if (settled && settled.key === key && settled.state.status !== "error") return;
    let live = true;
    const asked = JSON.parse(key) as { datasetId: string; parameters: JobParameters };
    const finish = (state: Settled) => {
      if (live) setSettled({ key, state });
    };
    (async () => {
      try {
        const result = await draftChecks(asked.datasetId, asked.parameters);
        if (!result.ok) {
          // A draft the backend refuses as invalid is not a failed check: the wizard says what
          // is wrong with it.
          finish(result.reason === "error" && result.status === 422 ? { status: "none" } : { status: "error" });
        } else {
          finish({
            status: "ready",
            errors: result.data.errors,
            warnings: result.data.warnings,
            filesChecked: result.data.files_checked,
          });
        }
      } catch {
        finish({ status: "error" });
      }
    })();
    return () => {
      live = false;
    };
    // `settled` is read to skip a question already answered; it must not restart the request it
    // is the result of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  if (key === null) return { status: "none" };
  if (settled && settled.key === key) return settled.state;
  return enabled ? { status: "loading" } : { status: "none" };
}
