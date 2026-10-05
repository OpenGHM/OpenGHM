"use client";

import { useEffect, useState } from "react";
import { publishedAnswer } from "@/lib/jobs/actions";
import type { JobParameters, PublishedAnswer } from "@/lib/jobs/types";

/**
 * What the Review step knows about the snapshot's published results for the
 * draft on screen.
 *
 * - `loading`: asked, not answered yet.
 * - `answered`: the published output answers the draft; `answer` lists the files.
 * - `none`: it does not (or nothing was asked: the draft is not complete enough
 *   to ask about, or the answer lists no files), so the draft is submitted as
 *   ever.
 * - `error`: the check itself failed (the listing is down, the network, a
 *   session that ended). Never a reason to stop a submit.
 */
export type PublishedAnswerState =
  | { status: "loading" }
  | { status: "answered"; answer: PublishedAnswer }
  | { status: "none" }
  | { status: "error" };

type Settled = Exclude<PublishedAnswerState, { status: "loading" }>;

/** The draft says enough to ask about: a period that runs forwards and at least
 *  one variable. Anything less is the wizard's own problem to flag, not a
 *  question for the backend (which would refuse it with a 422). */
function askable(parameters: JobParameters): boolean {
  const { temporal_range_start: start, temporal_range_end: end, variables } = parameters;
  return !!start && !!end && start <= end && variables.length > 0;
}

/**
 * Asks the backend whether the snapshot's published output answers the draft,
 * for the parameters on screen, saved or not (the endpoint takes parameters, not
 * a job id, so a new snapshot draft asks too).
 *
 * One request per distinct question while `enabled` (the Review step is
 * showing): the answer is kept for as long as the wizard lives, so going back to
 * Run settings and returning with the same parameters does not ask again, and a
 * change of period, variables or model input does. There is no debounce because
 * nothing is typed on Review. An answer that arrives after the question has
 * changed is dropped. `refresh()` asks again (after a submit was refused as
 * answered, which means the page was out of step).
 */
export function usePublishedAnswer({
  datasetId,
  parameters,
  modelInputId,
  enabled,
}: {
  datasetId: string;
  parameters: JobParameters;
  modelInputId: string | null;
  enabled: boolean;
}): { state: PublishedAnswerState; refresh: () => void } {
  // The question as one string: the effect depends on what is asked, not on the
  // identity of an object that is rebuilt on every keystroke elsewhere.
  const key = enabled && askable(parameters) ? JSON.stringify({ datasetId, parameters, modelInputId }) : null;
  const [round, setRound] = useState(0);
  const [settled, setSettled] = useState<{ key: string; round: number; state: Settled } | null>(null);

  useEffect(() => {
    if (key === null) return;
    // Held in the cache already: nothing to ask.
    if (settled && settled.key === key && settled.round === round) return;
    let live = true;
    const asked = JSON.parse(key) as {
      datasetId: string;
      parameters: JobParameters;
      modelInputId: string | null;
    };
    const finish = (state: Settled) => {
      if (live) setSettled({ key, round, state });
    };
    (async () => {
      try {
        const result = await publishedAnswer(asked.datasetId, asked.parameters, asked.modelInputId);
        if (!result.ok) {
          // A draft the backend refuses as invalid is not a failed check: the
          // wizard already says what is wrong with it.
          finish(result.reason === "error" && result.status === 422 ? { status: "none" } : { status: "error" });
        } else if (result.data.answered && result.data.files.length > 0) {
          finish({ status: "answered", answer: result.data });
        } else {
          finish({ status: "none" });
        }
      } catch {
        finish({ status: "error" });
      }
    })();
    return () => {
      live = false;
    };
    // `settled` is read to skip a question already answered; it must not
    // restart the request it is the result of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, round]);

  let state: PublishedAnswerState;
  if (key === null) state = { status: "none" };
  else if (settled && settled.key === key && settled.round === round) state = settled.state;
  else state = { status: "loading" };

  return { state, refresh: () => setRound((n) => n + 1) };
}
