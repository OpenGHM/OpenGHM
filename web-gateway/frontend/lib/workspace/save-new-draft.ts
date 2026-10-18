/**
 * Saving a snapshot draft that so far exists only in the browser (`/workspace/new/
 * <snapshot id>`): create the stored DRAFT, then put what the person changed
 * into it. No React and no server action of its own: the two calls are
 * injected, so the rules (one draft per saver, what a half-saved result says)
 * are plain to test; `use-save-new-draft.ts` wires them to the screen.
 *
 * - **Create.** `derive` stores the draft with the server's defaults. It runs
 *   at most once per saver: the draft that came back is remembered, and every
 *   later save (a retry after a failed submit, Save as draft after Submit's
 *   flush) only sends what still differs. A save made while another is
 *   running waits for it, so no two calls can create two drafts.
 * - **Fill.** `buildDraftPatch` against the created draft, as saving a stored draft does. A
 *   refusal of one group (a 4xx that is not about the session or a conflict)
 *   is remembered and the rest is sent again, at most once per group.
 * - **Outcome.** Once the draft exists, a failure after that is not a failure
 *   of the save: the draft is real. The result then says which fields the
 *   stored draft does not hold (`notSaved`) and why (`patchError`), and the
 *   caller opens the draft anyway. Only a failed create is `ok: false`.
 */
import type { ActionResult, Job, DraftUpdateRequest } from "@/lib/jobs/types";
import {
  buildDraftPatch,
  refuseGroups,
  refuseStart,
  unsavedFields,
  type DraftContext,
  type DraftField,
  type DraftLocal,
  type ServerRefusals,
} from "@/lib/workspace/draft-state";
import { FIELD_LABELS } from "@/lib/workspace/draft-wizard";

export interface SaveNewDraftDeps {
  /** `deriveDraft`: creates the stored draft. */
  derive: (datasetId: string) => Promise<ActionResult<Job>>;
  /** `updateDraft`: saves a patch into it. */
  update: (jobId: string, patch: DraftUpdateRequest) => Promise<ActionResult<Job>>;
}

export type SaveNewDraftFailure =
  | { reason: "session_expired" }
  | { reason: "error"; message: string };

export type SaveNewDraftResult =
  /** The draft exists. `job` is what the server last answered with. */
  | {
      ok: true;
      job: Job;
      /** Fields of the screen that `job` does not hold. Empty when all is saved. */
      notSaved: DraftField[];
      /** Why the settings could not be sent, or null when they were (and
       *  `notSaved` is then only what the server would not take). */
      patchError: string | null;
    }
  /** Nothing was created. */
  | { ok: false; failure: SaveNewDraftFailure };

/** The words for a snapshot that left the repository, as the Start screen says it. */
export const SNAPSHOT_GONE = "That model snapshot is no longer in the repository.";

/** One group may be refused once each: model input, parameters, cores and
 *  walltime, about. */
const MAX_PATCHES = 4;

/** A 4xx that is the server declining this change, as opposed to a session
 *  that ended (401), a missing or changed draft (404, 409), or a request to
 *  try again later (408, 429). Same split as the stored draft's saver. */
function isRefusal(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500 && ![401, 404, 408, 409, 429].includes(status);
}

/** What a thrown error says to the person: the fixed sentence. The error itself
 *  is for the console, not for them. */
const messageOf = (error: unknown, fallback: string) => {
  console.error(fallback, error);
  return fallback;
};

export function createNewDraftSaver(deps: SaveNewDraftDeps) {
  // The stored draft as the server last answered, once there is one.
  let current: Job | null = null;
  // Saves run one after another.
  let queue: Promise<unknown> = Promise.resolve();

  async function run(datasetId: string, local: DraftLocal, ctx: DraftContext): Promise<SaveNewDraftResult> {
    if (current === null) {
      let created: ActionResult<Job>;
      try {
        created = await deps.derive(datasetId);
      } catch (error) {
        return { ok: false, failure: { reason: "error", message: messageOf(error, "Couldn't save the snapshot draft.") } };
      }
      if (!created.ok) {
        if (created.reason === "session_expired") return { ok: false, failure: { reason: "session_expired" } };
        if (created.reason === "not_found") return { ok: false, failure: { reason: "error", message: SNAPSHOT_GONE } };
        return { ok: false, failure: { reason: "error", message: created.message } };
      }
      current = created.data;
    }

    let refusals: ServerRefusals = {};
    let patchError: string | null = null;
    for (let sent = 0; sent < MAX_PATCHES; sent++) {
      const { patch } = buildDraftPatch(local, current, ctx, refusals);
      if (!patch) break;
      let result: ActionResult<Job>;
      try {
        result = await deps.update(current.id, patch);
      } catch (error) {
        result = { ok: false, reason: "error", message: messageOf(error, "Couldn't reach the server.") };
      }
      if (result.ok) {
        current = result.data;
        break;
      }
      if (result.reason === "session_expired") {
        patchError = "Your session has expired.";
        break;
      }
      if (result.reason === "not_found") {
        patchError = "The snapshot draft no longer exists.";
        break;
      }
      if (!isRefusal(result.status)) {
        patchError = result.message;
        break;
      }
      // The server declined this change: leave that group out and send the rest.
      const sentStart = patch.parameters?.temporal_range_start;
      refusals =
        result.code === "run_start_not_aligned" && sentStart !== undefined
          ? refuseStart(refusals, {
              value: sentStart,
              message: result.message,
              suggestion: result.suggestedStart ?? null,
            })
          : refuseGroups(refusals, patch, { message: result.message, code: result.code, paths: result.fields });
    }

    return { ok: true, job: current, notSaved: unsavedFields(local, current, ctx), patchError };
  }

  return {
    /** Create the draft if there is none, then save `local` into it. */
    save(datasetId: string, local: DraftLocal, ctx: DraftContext): Promise<SaveNewDraftResult> {
      const next = queue.then(() => run(datasetId, local, ctx));
      queue = next.catch(() => {});
      return next;
    },
    /** The stored draft, once a save created it. */
    created(): Job | null {
      return current;
    },
  };
}

/** The sentence for the toast of a draft that was saved without some settings. */
export function describeNotSaved(fields: readonly DraftField[]): string {
  return `The snapshot draft was saved, but these settings weren't: ${fields.map((f) => FIELD_LABELS[f]).join(", ")}. Open it to set them again.`;
}
