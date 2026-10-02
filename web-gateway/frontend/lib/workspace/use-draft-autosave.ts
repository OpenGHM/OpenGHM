"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { updateSimulation } from "@/lib/jobs/actions";
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

/** How long to wait before the 1st, 2nd, ... retry of a save that got no
 *  answer. After the last one the save is reported as failed, with a Retry. */
export const RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000] as const;

export type SaveState =
  /** The server holds what is on screen; `at` is its `updated_at`. */
  | { kind: "saved"; at: string | null }
  /** A change is waiting for its pause, or a request is out. */
  | { kind: "saving" }
  /** The last request got no answer; the next attempt is already scheduled. */
  | { kind: "retrying"; attempt: number }
  /** Every attempt failed, or the server refused the same change twice.
   *  `retry()` tries again; so does the next edit. */
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

export interface UseDraftAutosave {
  state: SaveState;
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
   *  when the save failed or auto-save has stopped; `withheld` says what the
   *  `job` it returns does not hold. */
  flush: () => Promise<FlushResult>;
  /** Stop saving, for a Delete or a Submit that takes over. A request already
   *  out is let finish. */
  suspend: () => void;
  /** Start saving again after `suspend()`, for a Delete that was cancelled or a
   *  Submit that did not go through. Whatever changed meanwhile is saved after
   *  the usual pause. Does nothing when not suspended. */
  resume: () => void;
  /** Try again after a failure or an expired session. */
  retry: () => void;
}

type Halt = "session-expired" | "conflict" | "gone";

interface Failure {
  attempts: number;
  message: string;
  /** The local copy it happened for: an edit makes it stale. */
  localKey: string;
  final: boolean;
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
  debounceMs: number;
}

/** Statuses worth trying again: no answer, the server failing, or asking us to
 *  slow down. Any other 4xx is an answer, and sending the same thing again
 *  would only be answered the same way. */
const isRetryable = (status: number | undefined) =>
  status === undefined || status >= 500 || status === 408 || status === 429;

/**
 * The save loop, apart from React so that its timers and its one request in
 * flight are plain variables. It also holds the `Engine` the screen reads, as
 * an external store: `subscribe` and `getEngine` are for `useSyncExternalStore`.
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
  let mounted = false;
  const listeners = new Set<() => void>();
  const host = {
    engine: () => engine,
    latest: () => latest,
    mounted: () => mounted,
    commit(change: Partial<Engine>) {
      engine = { ...engine, ...change };
      listeners.forEach((listener) => listener());
    },
  };

  let debounce: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let draining: Promise<boolean> | null = null;
  let failures = 0;
  let lastOk: { patchKey: string; localKey: string } | null = null;
  let lastRefused: string | null = null;

  const clearDebounce = () => {
    if (debounce) clearTimeout(debounce);
    debounce = null;
  };
  const clearRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };

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
          "Draft auto-save stopped: the server's copy still differs from this draft after saving the same change.",
          patch
        );
        host.commit({ stall: { patchKey, localKey } });
        return true;
      }

      host.commit({ inflight: true });
      let result: ActionResult<Job>;
      try {
        result = await updateSimulation(latest.jobId, patch);
      } catch (error) {
        result = {
          ok: false,
          reason: "error",
          message: error instanceof Error ? error.message : "Couldn't reach the server.",
        };
      }

      if (result.ok) {
        writeDraftCache(result.data);
        lastOk = { patchKey, localKey };
        lastRefused = null;
        failures = 0;
        // The response is the new baseline and nothing else: the local copy is
        // what the person is typing into and is never overwritten by it.
        host.commit({ saved: result.data, failure: null, inflight: false, stall: null });
        // An edit made while this request was out has its own pause to wait for.
        if (debounce) return true;
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
        failures += 1;
        const final = failures > RETRY_DELAYS_MS.length;
        host.commit({
          failure: {
            attempts: failures,
            message: result.message,
            localKey: host.latest().localKey,
            final,
          },
        });
        if (!final && host.mounted()) {
          retryTimer = setTimeout(() => {
            retryTimer = null;
            void ensureDrain();
          }, RETRY_DELAYS_MS[failures - 1]);
        }
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
        host.commit({
          failure: { attempts: 0, message: result.message, localKey, final: true },
        });
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

  /** The local copy or what depends on it changed: wait for a pause. */
  function changed() {
    failures = 0;
    clearRetry();
    clearDebounce();
    const engine = host.engine();
    const latest = host.latest();
    if (engine.suspended || engine.halt || latest.disabled) return;
    if (!diff().patch) return;
    debounce = setTimeout(() => {
      debounce = null;
      void ensureDrain();
    }, latest.debounceMs);
  }

  async function flush(): Promise<FlushResult> {
    clearDebounce();
    clearRetry();
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
      // Edited while this was running; the pause that edit started is over.
      clearDebounce();
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
    setMounted(value: boolean) {
      mounted = value;
    },
    changed,
    flush,
    retry() {
      const engine = host.engine();
      if (engine.suspended || engine.halt === "conflict" || engine.halt === "gone") return;
      failures = 0;
      lastRefused = null;
      clearRetry();
      host.commit({ halt: null, failure: null });
      void flush();
    },
    online() {
      if (!host.engine().failure) return;
      failures = 0;
      clearRetry();
      void ensureDrain();
    },
    suspend() {
      clearDebounce();
      clearRetry();
      host.commit({ suspended: true });
    },
    resume() {
      if (!host.engine().suspended) return;
      failures = 0;
      host.commit({ suspended: false });
      changed();
    },
    /** Unmounting: leave nothing behind, and send what is still owed. */
    dispose() {
      clearDebounce();
      clearRetry();
      const engine = host.engine();
      if (engine.suspended || engine.halt || host.latest().disabled) return;
      if (diff().patch) void ensureDrain();
    },
  };
}

/**
 * Saves a draft as it is edited (the draft wizard, ADR 0028). The caller owns
 * the local copy and says when it changes; this sends the difference from the
 * last saved job after a pause, one request at a time, and reports how that is
 * going. Nothing is saved on mount, and an answer never replaces `local`.
 *
 * - **Pause.** `debounceMs` after the last change. `flush()` does not wait for
 *   it, and the page being hidden, left or unmounted does not either.
 * - **One request at a time.** A change made while one is out is sent after it,
 *   against the answer as the new baseline.
 * - **Answers.** Saved: the answer is the baseline. `run_start_not_aligned`:
 *   the start is refused, withheld and the rest sent again at once. Any other
 *   4xx (a 422 included): that group is withheld until it changes, no retry.
 *   401: stop (`session-expired`). 404: stop (`gone`). 409: stop (`conflict`).
 *   No answer, 5xx, 408 or 429: retry after 2, 4, 8, 16 and 30 s, then
 *   `failed`; going back online or the next edit tries again too.
 * - **`beforeunload`** is asked for only while something is unsaved.
 */
export function useDraftAutosave({
  jobId,
  initialSaved,
  local,
  ctx,
  debounceMs = 800,
  disabled = false,
}: {
  jobId: string;
  initialSaved: Job;
  local: DraftLocal;
  ctx: DraftContext;
  debounceMs?: number;
  /** Save nothing while true, e.g. while a submit is under way. */
  disabled?: boolean;
}): UseDraftAutosave {
  const localKey = useMemo(() => canonicalKey(local, ctx), [local, ctx]);

  const [saver] = useState(() =>
    createSaver(initialSaved, { jobId, local, ctx, localKey, disabled, debounceMs })
  );
  const engine = useSyncExternalStore(saver.subscribe, saver.getEngine, saver.getEngine);
  useEffect(() => {
    saver.setLatest({ jobId, local, ctx, localKey, disabled, debounceMs });
  });

  // A change to the draft, or to what is known about its snapshot (which can
  // change the verdict on a start date), starts the pause again.
  useEffect(() => {
    saver.changed();
  }, [saver, localKey, disabled, debounceMs, ctx.snapshotState, ctx.dataset?.id]);

  // Leaving: the pause is not waited for.
  useEffect(() => {
    saver.setMounted(true);
    return () => {
      saver.setMounted(false);
      saver.dispose();
    };
  }, [saver]);

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
  const unsaved = !engine.suspended && (pending || engine.inflight || withheld.length > 0 || failure !== null);

  // Hidden or leaving: save at once, the pause is not waited for.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void saver.flush();
    };
    const onPageHide = () => void saver.flush();
    const onOnline = () => saver.online();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("online", onOnline);
    };
  }, [saver]);

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
  else if (failure?.final) state = { kind: "failed", message: failure.message };
  else if (failure) state = { kind: "retrying", attempt: failure.attempts };
  else if (engine.inflight || pending) state = { kind: "saving" };
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

  return { state, saved: engine.saved, serverErrors: errors, startRefusal, withheld, flush, suspend, resume, retry };
}
