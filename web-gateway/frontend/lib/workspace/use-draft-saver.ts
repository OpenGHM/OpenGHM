"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { updateDraft } from "@/lib/jobs/actions";
import type { ActionResult, Job } from "@/lib/jobs/types";
import { writeDraftCache } from "@/lib/workspace/draft-cache";
import {
  buildDraftPatch,
  canonicalKey,
  clientProblem,
  fingerprint,
  refuseGroups,
  refuseStart,
  type DraftContext,
  type DraftField,
  type DraftLocal,
  type ServerRefusals,
} from "@/lib/workspace/draft-state";
import { FIELD_LABELS } from "@/lib/workspace/draft-wizard";

export type SaveState =
  /** The server holds what is on screen; `at` is its `updated_at`. */
  | { kind: "saved"; at: string | null }
  /** Something on screen is not saved and nothing is being sent: the person
   *  has to save (`flush()`). */
  | { kind: "unsaved" }
  /** A request is out. */
  | { kind: "saving" }
  /** The last save did not go through (no answer, a 5xx, a timeout), or the
   *  server refused the same change twice. Nothing is retried by itself:
   *  `retry()` or `flush()` tries again. */
  | { kind: "failed"; message: string }
  /** Everything that may be saved is, but these fields are not: they fail a
   *  check or the server refused them. Nothing to retry; the field changes. */
  | { kind: "refused"; fields: DraftField[]; message: string }
  | { kind: "session-expired" }
  /** The draft was submitted, or changed past DRAFT, somewhere else. */
  | { kind: "conflict" }
  /** The draft no longer exists. */
  | { kind: "gone" }
  /** `suspend()` was called, or the hook is `disabled`: nothing is saved. */
  | { kind: "suspended" };

export type FlushResult =
  | { ok: true; job: Job; withheld: DraftField[] }
  | { ok: false };

interface UseDraftSaver {
  state: SaveState;
  /** True while there is something the server does not hold and a save would
   *  put there, or could not: a difference waiting to be sent, a request out, a
   *  withheld field, a failed save. False when suspended or disabled, since
   *  nothing is owed then. What a "leave this page?" prompt asks about. */
  unsaved: boolean;
  /** The last job the server answered with: the baseline. Never the local copy. */
  saved: Job;
  /** What the server said about a field it did not take, by field. */
  serverErrors: Partial<Record<DraftField, string>>;
  /** The server's refusal of the current start date, in `RunStartNote`'s
   *  `problem` shape; null once the start changes. */
  startRefusal: { message: string; suggestion: string | null } | null;
  /** Fields whose local value is not saved and will not be until it changes. */
  withheld: DraftField[];
  /** Save now, and resolve once nothing is in flight or waiting. `ok: false`
   *  when the save failed or saving has stopped; `withheld` says what the
   *  `job` it returns does not hold. The only thing that sends anything. */
  flush: () => Promise<FlushResult>;
  /** Stop saving, for a Delete or a Submit that takes over. A request already
   *  out is let finish. */
  suspend: () => void;
  /** Allow saving again after `suspend()`, for a Delete that was cancelled or a
   *  Submit that did not go through. Sends nothing by itself. Does nothing when
   *  not suspended. */
  resume: () => void;
  /** Save again after a failure or an expired session: what the Retry button does. */
  retry: () => void;
}

type Halt = "session-expired" | "conflict" | "gone";

interface Failure {
  message: string;
  /** The local copy it happened for: an edit makes it stale. */
  localKey: string;
}

/** What the save loop has learned; the render reads it, the loop writes it. */
interface Engine {
  saved: Job;
  refusals: ServerRefusals;
  failure: Failure | null;
  halt: Halt | null;
  suspended: boolean;
  inflight: boolean;
  /** Set by the loop breaker; see `loop`. */
  stall: { localKey: string; patchKey: string } | null;
}

interface Latest {
  jobId: string;
  local: DraftLocal;
  ctx: DraftContext;
  localKey: string;
  disabled: boolean;
}

/** Statuses that mean "try again later": no answer, the server failing, or
 *  asking us to slow down. Any other 4xx is an answer, and sending the same
 *  thing again would only be answered the same way. */
const isRetryable = (status: number | undefined) =>
  status === undefined || status >= 500 || status === 408 || status === 429;

/**
 * The save loop, apart from React so that its one request in flight is a plain
 * variable. It also holds the `Engine` the screen reads, as an external store:
 * `subscribe` and `getEngine` are for `useSyncExternalStore`. Nothing in it
 * starts by itself: every request begins in `flush()`.
 */
function createSaver(initialSaved: Job, initialLatest: Latest) {
  let engine: Engine = {
    saved: initialSaved,
    refusals: {},
    failure: null,
    halt: null,
    suspended: false,
    inflight: false,
    stall: null,
  };
  let latest = initialLatest;
  const listeners = new Set<() => void>();
  const host = {
    engine: () => engine,
    latest: () => latest,
    commit(change: Partial<Engine>) {
      engine = { ...engine, ...change };
      listeners.forEach((listener) => listener());
    },
  };

  let draining: Promise<boolean> | null = null;
  let lastOk: { patchKey: string; localKey: string } | null = null;
  let lastRefused: string | null = null;

  const diff = () => {
    const { local, ctx } = host.latest();
    const { saved, refusals } = host.engine();
    return buildDraftPatch(local, saved, ctx, refusals);
  };

  /**
   * Send what differs until nothing does. Resolves true when it ended with
   * nothing left to send (a refused group counts: it is withheld, not owed),
   * false when it stopped on a failure or because saving is off.
   */
  async function loop(): Promise<boolean> {
    for (;;) {
      const engine = host.engine();
      const latest = host.latest();
      if (engine.suspended || engine.halt || latest.disabled) return false;

      const { patch } = diff();
      if (!patch) return true;
      const patchKey = fingerprint(patch);
      const { localKey } = latest;

      // Loop breaker: the same change, for the same local copy, straight after
      // it succeeded. Whatever the server stores does not equal what was
      // typed, and sending it again would never settle.
      if (lastOk && lastOk.patchKey === patchKey && lastOk.localKey === localKey) {
        console.error(
          "Draft save stopped: the server's copy still differs from this draft after saving the same change.",
          patch
        );
        host.commit({ stall: { patchKey, localKey } });
        return true;
      }

      // A new attempt: the last failure is history until this one says otherwise.
      host.commit({ inflight: true, failure: null });
      let result: ActionResult<Job>;
      try {
        result = await updateDraft(latest.jobId, patch);
      } catch (error) {
        console.error("Saving a snapshot draft failed", error);
        result = { ok: false, reason: "error", message: "Couldn't reach the server." };
      }

      if (result.ok) {
        writeDraftCache(result.data);
        lastOk = { patchKey, localKey };
        lastRefused = null;
        // The response is the new baseline and nothing else: the local copy is
        // what the person is typing into and is never overwritten by it.
        host.commit({ saved: result.data, failure: null, inflight: false, stall: null });
        continue;
      }

      host.commit({ inflight: false });
      if (host.engine().suspended) return false;
      if (result.reason === "session_expired") {
        host.commit({ halt: "session-expired" });
        return false;
      }
      if (result.reason === "not_found") {
        host.commit({ halt: "gone" });
        return false;
      }
      if (result.status === 409) {
        host.commit({ halt: "conflict" });
        return false;
      }

      if (isRetryable(result.status)) {
        // Not tried again by itself: the person presses Retry or Save.
        host.commit({ failure: { message: result.message, localKey: host.latest().localKey } });
        return false;
      }

      // An answer that refuses what was sent. Remember what, so that it is
      // withheld instead of sent again, and carry on with the rest.
      const refusals = host.engine().refusals;
      const sentStart = patch.parameters?.temporal_range_start;
      const next =
        result.code === "run_start_not_aligned" && sentStart !== undefined
          ? refuseStart(refusals, {
              value: sentStart,
              message: result.message,
              suggestion: result.suggestedStart ?? null,
            })
          : refuseGroups(refusals, patch, {
              message: result.message,
              code: result.code,
              paths: result.fields,
            });
      if (lastRefused === patchKey) {
        // The same patch refused again, so the refusal did not take hold.
        host.commit({ failure: { message: result.message, localKey } });
        return false;
      }
      lastRefused = patchKey;
      host.commit({ refusals: next });
    }
  }

  function ensureDrain(): Promise<boolean> {
    if (draining) return draining;
    const run = (async () => {
      try {
        return await loop();
      } finally {
        draining = null;
      }
    })();
    draining = run;
    return run;
  }

  async function flush(): Promise<FlushResult> {
    for (;;) {
      const ok = await ensureDrain();
      const engine = host.engine();
      if (!ok || engine.suspended || engine.halt) return { ok: false };
      const { patch, withheld } = diff();
      const { localKey } = host.latest();
      const stalled =
        patch !== null &&
        engine.stall?.localKey === localKey &&
        engine.stall.patchKey === fingerprint(patch);
      if (!patch || stalled) return { ok: true, job: engine.saved, withheld };
      // Edited while this was running: that is part of this save too.
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getEngine: () => engine,
    /** What the hook was last rendered with; the loop reads it, never React. */
    setLatest(next: Latest) {
      latest = next;
    },
    flush,
    retry() {
      const engine = host.engine();
      if (engine.suspended || engine.halt === "conflict" || engine.halt === "gone") return;
      lastRefused = null;
      host.commit({ halt: null, failure: null });
      void flush();
    },
    suspend() {
      host.commit({ suspended: true });
    },
    resume() {
      if (!host.engine().suspended) return;
      host.commit({ suspended: false });
    },
  };
}

/**
 * Saves a stored draft when the person asks (the draft wizard, ADR 0028). The
 * caller owns the local copy; this sends the difference from the last saved job
 * when `flush()` is called (the Save draft button, Ctrl/Cmd+S, Submit, the
 * leave dialog), one request at a time, and reports how that went. Nothing is
 * ever sent by itself: not on a change, a pause, a step change, the tab being
 * hidden, the page being left or unmounted, coming back online, or after a
 * failure. An answer never replaces `local`.
 *
 * - **One request at a time.** An edit made while a save is out is sent by the
 *   same `flush()` afterwards, against the answer as the new baseline.
 * - **Answers.** Saved: the answer is the baseline. `run_start_not_aligned`:
 *   the start is refused, withheld and the rest sent again at once. Any other
 *   4xx (a 422 included): that group is withheld until it changes, no retry.
 *   401: stop (`session-expired`). 404: stop (`gone`). 409: stop (`conflict`).
 *   No answer, 5xx, 408 or 429: `failed`, until `retry()` or `flush()`.
 * - **`unsaved`** says whether leaving would lose something; the
 *   `beforeunload` prompt is asked for only while it is true.
 */
export function useDraftSaver({
  jobId,
  initialSaved,
  local,
  ctx,
  disabled = false,
}: {
  jobId: string;
  initialSaved: Job;
  local: DraftLocal;
  ctx: DraftContext;
  /** Save nothing while true: the draft is not stored (a new snapshot draft). */
  disabled?: boolean;
}): UseDraftSaver {
  const localKey = useMemo(() => canonicalKey(local, ctx), [local, ctx]);

  const [saver] = useState(() => createSaver(initialSaved, { jobId, local, ctx, localKey, disabled }));
  const engine = useSyncExternalStore(saver.subscribe, saver.getEngine, saver.getEngine);
  useEffect(() => {
    saver.setLatest({ jobId, local, ctx, localKey, disabled });
  });

  const flush = useCallback(() => saver.flush(), [saver]);
  const suspend = useCallback(() => saver.suspend(), [saver]);
  const resume = useCallback(() => saver.resume(), [saver]);
  const retry = useCallback(() => saver.retry(), [saver]);

  const { patch, withheld, errors } = useMemo(
    () => buildDraftPatch(local, engine.saved, ctx, engine.refusals),
    [local, ctx, engine.saved, engine.refusals]
  );
  const stalled =
    patch !== null &&
    engine.stall?.localKey === localKey &&
    engine.stall.patchKey === fingerprint(patch);
  const pending = patch !== null && !stalled;
  const failure = engine.failure?.localKey === localKey ? engine.failure : null;
  // A hook that is suspended or `disabled` saves nothing and owes nothing, so it asks nothing.
  const unsaved = !engine.suspended && !disabled && (pending || engine.inflight || withheld.length > 0 || failure !== null);

  // The browser's own "leave this page?" prompt, only while it matters.
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);

  let state: SaveState;
  if (engine.halt) state = { kind: engine.halt };
  else if (engine.suspended || disabled) state = { kind: "suspended" };
  else if (failure) state = { kind: "failed", message: failure.message };
  else if (engine.inflight) state = { kind: "saving" };
  else if (pending) state = { kind: "unsaved" };
  else if (withheld.length > 0) {
    const message =
      errors[withheld[0]] ??
      clientProblem(withheld[0], local, ctx) ??
      `${FIELD_LABELS[withheld[0]]} isn't saved.`;
    state = { kind: "refused", fields: withheld, message };
  } else state = { kind: "saved", at: engine.saved.updated_at };

  const start = engine.refusals.start;
  const startRefusal =
    start && start.value === local.parameters.temporal_range_start
      ? { message: start.message, suggestion: start.suggestion }
      : null;

  return { state, unsaved, saved: engine.saved, serverErrors: errors, startRefusal, withheld, flush, suspend, resume, retry };
}
