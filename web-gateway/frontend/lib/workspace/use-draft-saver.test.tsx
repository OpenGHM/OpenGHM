import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ActionResult, Job, PartialAbout, DraftUpdateRequest } from "@/lib/jobs/types";

vi.mock("@/lib/jobs/actions", () => ({ updateDraft: vi.fn() }));

import { updateDraft } from "@/lib/jobs/actions";
import { clearDraftCache, readDraftCache } from "@/lib/workspace/draft-cache";
import { fromJob, type DraftContext, type DraftLocal } from "@/lib/workspace/draft-state";
import { useDraftSaver, type FlushResult } from "@/lib/workspace/use-draft-saver";
import { fakeDataset, fakeDraft } from "@/lib/workspace/fixtures";

const update = vi.mocked(updateDraft);

const dataset = fakeDataset({
  runStartAlignment: "year",
  simulation: {
    ...fakeDataset().simulation,
    temporalCoverage: { start: "2000-01-01", end: "2004-12-31" },
    outputVariables: [
      { name: "discharge", fullName: "Discharge", unit: "m3/s" },
      { name: "runoff", fullName: "Runoff", unit: "mm" },
    ],
  },
});
const FOUND: DraftContext = { dataset, snapshotState: "found" };
// No snapshot to check a start against: only the server can refuse one.
const UNCHECKED: DraftContext = { dataset: null, snapshotState: "unavailable" };

const JOB = fakeDraft("DRAFT", {
  id: "job-1",
  updated_at: "2026-10-01T12:00:00.000Z",
  parameters: {
    temporal_range_start: "2001-01-01",
    temporal_range_end: "2003-12-31",
    spatial_domain: null,
    variables: ["discharge", "runoff"],
    custom_params: null,
  },
  slurm_config: { cores: null },
});

/** What the backend does with a PATCH, as far as these tests need. */
function fakeServer(initial: Job = JOB) {
  let current = initial;
  let n = 0;
  return {
    get current() {
      return current;
    },
    impl: async (_id: string, patch: DraftUpdateRequest): Promise<ActionResult<Job>> => {
      n += 1;
      let about: PartialAbout | null = current.about;
      if (patch.about !== undefined) {
        const merged = Object.fromEntries(
          Object.entries({ ...(current.about ?? {}), ...(patch.about ?? {}) }).filter(([, v]) => v != null)
        ) as PartialAbout;
        about = patch.about === null || Object.keys(merged).length === 0 ? null : merged;
      }
      current = {
        ...current,
        about,
        parameters: patch.parameters ?? current.parameters,
        slurm_config: patch.slurm_config ? { ...current.slurm_config, ...patch.slurm_config } : current.slurm_config,
        model_input_id: "model_input_id" in patch ? (patch.model_input_id ?? null) : current.model_input_id,
        updated_at: new Date(Date.UTC(2026, 9, 1, 12, 0, n)).toISOString(),
      };
      return { ok: true, data: current };
    },
  };
}

const failure = (status: number | undefined, extra: Record<string, unknown> = {}): ActionResult<Job> => ({
  ok: false,
  reason: "error",
  message: `failed ${status ?? "without a status"}`,
  status,
  ...extra,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const patches = () => update.mock.calls.map((call) => call[1]);

function setup(job: Job = JOB, ctx: DraftContext = FOUND) {
  const hook = renderHook(
    (props: { local: DraftLocal; disabled?: boolean }) =>
      useDraftSaver({ jobId: job.id, initialSaved: job, ctx, ...props }),
    { initialProps: { local: fromJob(job) } as { local: DraftLocal; disabled?: boolean } }
  );
  const base = fromJob(job);
  return {
    ...hook,
    base,
    /** Replace the local copy, as a field's onChange does. */
    set: (local: DraftLocal, disabled?: boolean) => act(() => hook.rerender({ local, disabled })),
    name: (name: string) => act(() => hook.rerender({ local: { ...fromJob(job), name } })),
  };
}

const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** Press Save: `flush()` inside act, with what it answered. */
async function save(result: { current: { flush: () => Promise<FlushResult> } }): Promise<FlushResult> {
  let answer!: FlushResult;
  await act(async () => {
    answer = await result.current.flush();
  });
  return answer;
}

const prompted = () => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

const withCores = (local: DraftLocal, cores: number | null): DraftLocal => ({
  ...local,
  slurm: { ...local.slurm, cores },
});

beforeEach(() => {
  vi.useFakeTimers();
  // Every test that does not say otherwise talks to a server that saves.
  update.mockReset();
  update.mockImplementation(fakeServer().impl);
  clearDraftCache();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("when nothing was edited", () => {
  it("is saved on mount, however long it waits, and sends nothing", async () => {
    const server = fakeServer();
    update.mockImplementation(server.impl);
    const { result } = setup();
    await wait(60_000);
    expect(update).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: "saved", at: JOB.updated_at });
    expect(result.current.unsaved).toBe(false);
    expect(result.current.saved).toBe(JOB);
  });

  it("is saved for a draft whose variables are stored in another order than the snapshot's", async () => {
    const job = { ...JOB, parameters: { ...JOB.parameters, variables: ["runoff", "discharge"] } };
    const { result } = setup(job);
    await wait(10_000);
    expect(update).not.toHaveBeenCalled();
    expect(result.current.state.kind).toBe("saved");
  });

  it("is saved when the same local copy is passed again as a new object", async () => {
    const { rerender, result } = setup();
    rerender({ local: fromJob(JOB) });
    await wait(10_000);
    expect(update).not.toHaveBeenCalled();
    expect(result.current.unsaved).toBe(false);
  });
});

describe("nothing is sent until flush", () => {
  it("an edit is unsaved, and stays so however long it waits", async () => {
    update.mockImplementation(fakeServer().impl);
    const { result, name } = setup();
    name("Run");
    expect(result.current.state).toEqual({ kind: "unsaved" });
    expect(result.current.unsaved).toBe(true);
    await wait(10 * 60_000);
    expect(update).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: "unsaved" });
  });

  it("rapid edits send nothing either", async () => {
    update.mockImplementation(fakeServer().impl);
    const { name } = setup();
    for (const value of ["R", "Ru", "Run"]) {
      name(value);
      await wait(300);
    }
    await wait(5_000);
    expect(update).not.toHaveBeenCalled();
  });

  it("the page being hidden, left, or coming back online sends nothing", async () => {
    update.mockImplementation(fakeServer().impl);
    const { name } = setup();
    name("Run");
    const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
      window.dispatchEvent(new Event("online"));
    });
    state.mockRestore();
    await wait(60_000);
    expect(update).not.toHaveBeenCalled();
  });

  it("unmounting sends nothing, and leaves no timer behind", async () => {
    update.mockImplementation(fakeServer().impl);
    const { name, unmount } = setup();
    name("Run");
    await act(async () => {
      unmount();
    });
    await wait(60_000);
    expect(update).not.toHaveBeenCalled();
  });

  it("an edit that was undone is not unsaved", async () => {
    const { name, result } = setup();
    name("Run");
    expect(result.current.unsaved).toBe(true);
    name("");
    expect(result.current.state.kind).toBe("saved");
    expect(result.current.unsaved).toBe(false);
    await wait(5_000);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("flush", () => {
  it("sends the difference once, at once, and says what the saved job holds", async () => {
    const server = fakeServer();
    update.mockImplementation(server.impl);
    const { result, name } = setup();
    for (const value of ["R", "Ru", "Run"]) name(value);

    const flushed = await save(result);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("job-1", { about: { name: "Run", description: null } });
    expect(flushed).toEqual({ ok: true, job: server.current, withheld: [] });
    expect(result.current.state).toEqual({ kind: "saved", at: server.current.updated_at });
    expect(result.current.unsaved).toBe(false);
    await wait(60_000);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("saves the groups an edit touched and no others", async () => {
    update.mockImplementation(fakeServer().impl);
    const { result, set, base } = setup();
    set(withCores(base, 4));
    await save(result);
    expect(patches()).toEqual([{ slurm_config: { cores: 4 } }]);
  });

  it("the answer is the baseline, never written over the local copy", async () => {
    const server = fakeServer();
    update.mockImplementation(server.impl);
    const { result, name } = setup();
    name("Run");
    await save(result);
    expect(result.current.saved).toBe(server.current);
    expect(result.current.saved.updated_at).not.toBe(JOB.updated_at);
  });

  it("remembers the saved job for the back/forward cache", async () => {
    const server = fakeServer();
    update.mockImplementation(server.impl);
    const { result, name } = setup();
    name("Run");
    await save(result);
    expect(readDraftCache("job-1")).toBe(server.current);
  });

  it("sends nothing the second time when nothing changed since", async () => {
    update.mockImplementation(fakeServer().impl);
    const { result, name } = setup();
    name("Run");
    await save(result);
    const again = await save(result);
    expect(update).toHaveBeenCalledTimes(1);
    expect(again.ok).toBe(true);
  });

  it("resolves with no request when nothing is owed", async () => {
    const { result } = setup();
    const flushed = await save(result);
    expect(update).not.toHaveBeenCalled();
    expect(flushed).toEqual({ ok: true, job: JOB, withheld: [] });
  });

  it("an edit made while it is out is sent by the same flush, from the answer as the new baseline", async () => {
    const first = deferred<ActionResult<Job>>();
    const server = fakeServer();
    update.mockImplementationOnce(async (id, patch) => {
      await server.impl(id, patch);
      return first.promise;
    });
    update.mockImplementation(server.impl);
    const { result, set, base, name } = setup();

    name("Run");
    let flushed: unknown;
    act(() => {
      void result.current.flush().then((r) => (flushed = r));
    });
    await wait(0);
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ kind: "saving" });

    // Typed while the first request is out.
    set({ ...base, name: "Run 2", slurm: { cores: 8 } });
    await wait(5_000);
    expect(update).toHaveBeenCalledTimes(1);
    expect(flushed).toBeUndefined();

    // The answer is a name the person has already changed.
    first.resolve({ ok: true, data: { ...server.current, about: { name: "Run" } } });
    await wait(0);
    expect(update).toHaveBeenCalledTimes(2);
    expect(patches()[1]).toEqual({
      about: { name: "Run 2", description: null },
      slurm_config: { cores: 8 },
    });
    expect(flushed).toMatchObject({ ok: true, job: { about: { name: "Run 2" } } });
    expect(result.current.state.kind).toBe("saved");
    expect(server.current.about).toEqual({ name: "Run 2" });
  });

  it("never has two requests out at once, however many times it is pressed", async () => {
    const answers = [deferred<ActionResult<Job>>(), deferred<ActionResult<Job>>()];
    let out = 0;
    let most = 0;
    const server = fakeServer();
    update.mockImplementation(async (id, patch) => {
      out += 1;
      most = Math.max(most, out);
      const answer = answers[update.mock.calls.length - 1];
      const data = await answer.promise;
      await server.impl(id, patch);
      out -= 1;
      return data;
    });
    const { result, set, base } = setup();

    set({ ...base, name: "a" });
    act(() => {
      void result.current.flush();
      void result.current.flush();
    });
    await wait(0);
    set({ ...base, name: "ab" });
    act(() => void result.current.flush());
    await wait(5_000);
    expect(update).toHaveBeenCalledTimes(1);

    answers[0].resolve({ ok: true, data: { ...JOB, about: { name: "a" }, updated_at: "2026-10-01T12:00:01.000Z" } });
    await wait(0);
    expect(update).toHaveBeenCalledTimes(2);
    answers[1].resolve({ ok: true, data: { ...JOB, about: { name: "ab" }, updated_at: "2026-10-01T12:00:02.000Z" } });
    await wait(0);
    expect(most).toBe(1);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("lists what the saved job does not hold", async () => {
    update.mockImplementation(fakeServer().impl);
    const { result, set, base } = setup();
    set({ ...withCores(base, 0), name: "Run" });
    const flushed = await save(result);
    expect(patches()).toEqual([{ about: { name: "Run", description: null } }]);
    expect(flushed).toMatchObject({ ok: true, withheld: ["cores"] });
  });

  it("is not ok when the save did not go through", async () => {
    update.mockResolvedValue(failure(503));
    const { result, name } = setup();
    name("Run");
    expect(await save(result)).toEqual({ ok: false });
  });
});

describe("what the server answers", () => {
  it("ok: the state says when it was saved", async () => {
    const server = fakeServer();
    update.mockImplementation(server.impl);
    const { result, name } = setup();
    name("Run");
    await save(result);
    expect(result.current.state).toEqual({ kind: "saved", at: server.current.updated_at });
  });

  describe("422 run_start_not_aligned", () => {
    const MESSAGE = "A run must start on January 1. Start on 2001-01-01 instead.";
    const refusal = failure(422, {
      code: "run_start_not_aligned",
      message: MESSAGE,
      suggestedStart: "2001-01-01",
    });

    it("withholds the start, and sends the rest again at once with the saved start", async () => {
      const server = fakeServer();
      update.mockResolvedValueOnce(refusal);
      update.mockImplementation(server.impl);
      const { result, set, base } = setup(JOB, UNCHECKED);

      set({
        ...base,
        parameters: { ...base.parameters, temporal_range_start: "2001-03-15", temporal_range_end: "2002-12-31" },
      });
      await save(result);

      expect(update).toHaveBeenCalledTimes(2);
      expect(patches()[0]!.parameters).toMatchObject({ temporal_range_start: "2001-03-15", temporal_range_end: "2002-12-31" });
      expect(patches()[1]!.parameters).toMatchObject({ temporal_range_start: "2001-01-01", temporal_range_end: "2002-12-31" });
      expect(server.current.parameters.temporal_range_end).toBe("2002-12-31");

      expect(result.current.withheld).toEqual(["start"]);
      expect(result.current.serverErrors.start).toBe(MESSAGE);
      expect(result.current.startRefusal).toEqual({ message: MESSAGE, suggestion: "2001-01-01" });
      expect(result.current.state).toEqual({
        kind: "refused",
        fields: ["start"],
        message: MESSAGE,
      });
      expect(result.current.unsaved).toBe(true);
    });

    it("is not asked again for the same start, and clears when the start changes", async () => {
      const server = fakeServer();
      update.mockResolvedValueOnce(refusal);
      update.mockImplementation(server.impl);
      const { result, set, base } = setup(JOB, UNCHECKED);
      const withStart = (start: string): DraftLocal => ({
        ...base,
        parameters: { ...base.parameters, temporal_range_start: start },
      });

      set(withStart("2001-03-15"));
      await save(result);
      // Nothing else to send: the refused start stays withheld and costs nothing.
      expect(update).toHaveBeenCalledTimes(1);
      await save(result);
      expect(update).toHaveBeenCalledTimes(1);
      expect(result.current.startRefusal).not.toBeNull();

      set(withStart("2002-01-01"));
      expect(result.current.startRefusal).toBeNull();
      expect(result.current.serverErrors.start).toBeUndefined();
      expect(result.current.state).toEqual({ kind: "unsaved" });
      await save(result);
      expect(update).toHaveBeenCalledTimes(2);
      expect(patches()[1]!.parameters).toMatchObject({ temporal_range_start: "2002-01-01" });
      expect(result.current.state.kind).toBe("saved");
    });

    it("does not loop when the server refuses a start that was not changed", async () => {
      update.mockResolvedValue(refusal);
      const { result, set, base } = setup(JOB, UNCHECKED);
      set({ ...base, parameters: { ...base.parameters, temporal_range_end: "2002-12-31" } });
      await save(result);
      await wait(10_000);
      expect(update.mock.calls.length).toBeLessThanOrEqual(2);
      expect(result.current.state.kind).toBe("failed");
    });
  });

  describe("any other 422, or other refusing 4xx", () => {
    it("withholds the group the answer names, saves the others, and does not retry", async () => {
      const server = fakeServer();
      update.mockResolvedValueOnce(
        failure(422, { message: "cores is too much", fields: ["slurm_config.cores"] })
      );
      update.mockImplementation(server.impl);
      const { result, set, base } = setup();

      set({ ...withCores(base, 99), name: "Run" });
      await save(result);

      expect(patches()).toEqual([
        { slurm_config: { cores: 99 }, about: { name: "Run", description: null } },
        { about: { name: "Run", description: null } },
      ]);
      expect(result.current.withheld).toEqual(["cores"]);
      expect(result.current.serverErrors).toEqual({ cores: "cores is too much" });
      expect(result.current.state).toEqual({ kind: "refused", fields: ["cores"], message: "cores is too much" });
      await wait(120_000);
      expect(update).toHaveBeenCalledTimes(2);
    });

    it("sends the group again once its value is another one", async () => {
      const server = fakeServer();
      update.mockResolvedValueOnce(failure(422, { message: "too much", fields: ["slurm_config.cores"] }));
      update.mockImplementation(server.impl);
      const { result, set, base } = setup();
      set(withCores(base, 99));
      await save(result);
      expect(result.current.state.kind).toBe("refused");

      set(withCores(base, 64));
      await save(result);
      expect(patches()[1]).toEqual({ slurm_config: { cores: 64 } });
      expect(result.current.state.kind).toBe("saved");
      expect(result.current.serverErrors).toEqual({});
    });

    it("an answer that names no field withholds everything that was sent", async () => {
      update.mockResolvedValue(failure(422, { message: "no" }));
      const { result, set, base } = setup();
      set({ ...withCores(base, 4), name: "Run" });
      await save(result);
      await wait(10_000);
      expect(update).toHaveBeenCalledTimes(1);
      expect(result.current.withheld).toEqual(["cores", "name", "description"]);
    });

    it("a 403 is refused too and not retried", async () => {
      update.mockResolvedValue(failure(403));
      const { result, name } = setup();
      name("Run");
      await save(result);
      await wait(120_000);
      expect(update).toHaveBeenCalledTimes(1);
      expect(result.current.state.kind).toBe("refused");
    });
  });

  it("401: stops, keeps the local copy, says the session ended, and sends nothing more", async () => {
    update.mockResolvedValue({ ok: false, reason: "session_expired" });
    const { result, name, set, base } = setup();
    name("Run");
    expect(await save(result)).toEqual({ ok: false });
    expect(result.current.state).toEqual({ kind: "session-expired" });

    set({ ...base, name: "Run 2" });
    expect(await save(result)).toEqual({ ok: false });
    await wait(120_000);
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ kind: "session-expired" });
  });

  it("401: retry() tries again, for after signing in elsewhere", async () => {
    update.mockResolvedValueOnce({ ok: false, reason: "session_expired" });
    const server = fakeServer();
    update.mockImplementation(server.impl);
    const { result, name } = setup();
    name("Run");
    await save(result);
    await act(async () => result.current.retry());
    expect(update).toHaveBeenCalledTimes(2);
    expect(result.current.state.kind).toBe("saved");
  });

  it("409: stops with a conflict, which retry() does not clear", async () => {
    update.mockResolvedValue(failure(409, { code: "not_a_draft", message: "Only a draft can be edited." }));
    const { result, name, set, base } = setup();
    name("Run");
    await save(result);
    expect(result.current.state).toEqual({ kind: "conflict" });

    set({ ...base, name: "Run 2" });
    await act(async () => result.current.retry());
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ kind: "conflict" });
  });

  it("404: stops, the draft is gone", async () => {
    update.mockResolvedValue({ ok: false, reason: "not_found" });
    const { result, name } = setup();
    name("Run");
    await save(result);
    expect(result.current.state).toEqual({ kind: "gone" });
    await save(result);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("no answer, a 5xx, a timeout", () => {
  it("fails and says so, and is not tried again by itself, however long it waits", async () => {
    update.mockResolvedValue(failure(503));
    const { result, name } = setup();
    name("Run");
    expect(await save(result)).toEqual({ ok: false });
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ kind: "failed", message: "failed 503" });
    expect(result.current.unsaved).toBe(true);
    await wait(10 * 60_000);
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ kind: "failed", message: "failed 503" });
  });

  it("treats a request that throws, one with no status, a 408 and a 429 the same way", async () => {
    update.mockRejectedValueOnce(new Error("network down"));
    update.mockResolvedValueOnce(failure(undefined));
    update.mockResolvedValueOnce(failure(408));
    update.mockResolvedValueOnce(failure(429));
    const { result, name } = setup();
    name("Run");
    await save(result);
    expect(result.current.state).toEqual({ kind: "failed", message: "Couldn't reach the server." });
    await save(result);
    expect(result.current.state).toEqual({ kind: "failed", message: "failed without a status" });
    await save(result);
    expect(result.current.state.kind).toBe("failed");
    await save(result);
    expect(result.current.state.kind).toBe("failed");
    expect(update).toHaveBeenCalledTimes(4);
  });

  it("retry() tries once, at once, and recovers when the server is back", async () => {
    update.mockResolvedValue(failure(503));
    const { result, name } = setup();
    name("Run");
    await save(result);
    expect(result.current.state.kind).toBe("failed");

    update.mockImplementation(fakeServer().impl);
    await act(async () => result.current.retry());
    expect(update).toHaveBeenCalledTimes(2);
    expect(result.current.state.kind).toBe("saved");
    await wait(60_000);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("retry() that fails again fails again, and waits to be pressed once more", async () => {
    update.mockResolvedValue(failure(503));
    const { result, name } = setup();
    name("Run");
    await save(result);
    await act(async () => result.current.retry());
    expect(update).toHaveBeenCalledTimes(2);
    expect(result.current.state.kind).toBe("failed");
    await wait(10 * 60_000);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("flush tries again too, and is saving while it does, not failed", async () => {
    update.mockResolvedValueOnce(failure(503));
    const answer = deferred<ActionResult<Job>>();
    update.mockReturnValueOnce(answer.promise);
    const { result, name } = setup();
    name("Run");
    await save(result);
    expect(result.current.state.kind).toBe("failed");

    act(() => void result.current.flush());
    await wait(0);
    expect(result.current.state).toEqual({ kind: "saving" });
    await act(async () => answer.resolve({ ok: true, data: { ...JOB, about: { name: "Run" }, updated_at: "2026-10-01T12:00:05.000Z" } }));
    expect(result.current.state.kind).toBe("saved");
  });

  it("the next edit makes the failure stale: unsaved again, with nothing sent", async () => {
    update.mockResolvedValueOnce(failure(503));
    update.mockImplementation(fakeServer().impl);
    const { result, set, base } = setup();
    set({ ...base, name: "Run" });
    await save(result);
    expect(result.current.state.kind).toBe("failed");

    set({ ...base, name: "Run 2" });
    expect(result.current.state).toEqual({ kind: "unsaved" });
    await wait(60_000);
    expect(update).toHaveBeenCalledTimes(1);
    await save(result);
    expect(patches()[1]).toMatchObject({ about: { name: "Run 2" } });
    expect(result.current.state.kind).toBe("saved");
  });

  it("going back online does not try", async () => {
    update.mockResolvedValueOnce(failure(undefined));
    update.mockImplementation(fakeServer().impl);
    const { result, name } = setup();
    name("Run");
    await save(result);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await wait(60_000);
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.current.state.kind).toBe("failed");
  });
});

describe("beforeunload", () => {
  it("is asked for only while something is unsaved", async () => {
    update.mockImplementation(fakeServer().impl);
    const { result, name } = setup();
    expect(prompted()).toBe(false);

    name("Run");
    expect(prompted()).toBe(true);
    await save(result);
    expect(prompted()).toBe(false);
  });

  it("is asked for while a request is out", async () => {
    const answer = deferred<ActionResult<Job>>();
    update.mockReturnValue(answer.promise);
    const { result, name } = setup();
    name("Run");
    act(() => void result.current.flush());
    await wait(0);
    expect(prompted()).toBe(true);
    await act(async () =>
      answer.resolve({ ok: true, data: { ...JOB, about: { name: "Run" }, updated_at: "2026-10-01T12:00:05.000Z" } })
    );
    expect(prompted()).toBe(false);
  });

  it("is asked for while a value is withheld", async () => {
    update.mockImplementation(fakeServer().impl);
    const { set, base, result } = setup();
    set(withCores(base, 0));
    expect(result.current.state.kind).toBe("refused");
    expect(update).not.toHaveBeenCalled();
    expect(prompted()).toBe(true);
    set(withCores(base, 4));
    await save(result);
    expect(prompted()).toBe(false);
  });

  it("is asked for after a failure and not once saved again", async () => {
    update.mockResolvedValueOnce(failure(503));
    update.mockImplementation(fakeServer().impl);
    const { result, name } = setup();
    name("Run");
    await save(result);
    expect(prompted()).toBe(true);
    await save(result);
    expect(prompted()).toBe(false);
  });

  it("is not left behind when the hook unmounts", async () => {
    const { name, unmount } = setup();
    name("Run");
    expect(prompted()).toBe(true);
    unmount();
    expect(prompted()).toBe(false);
  });
});

describe("suspend", () => {
  it("stops saving: flush does nothing, the state says so and nothing is owed", async () => {
    update.mockImplementation(fakeServer().impl);
    const { result, name, set, base } = setup();
    name("Run");
    act(() => result.current.suspend());
    expect(result.current.state).toEqual({ kind: "suspended" });
    expect(result.current.unsaved).toBe(false);
    expect(await save(result)).toEqual({ ok: false });
    set({ ...base, name: "Run 2" });
    expect(await save(result)).toEqual({ ok: false });
    expect(update).not.toHaveBeenCalled();
    // The page stops asking before leaving.
    expect(prompted()).toBe(false);
  });

  it("lets a request that is out finish, and sends nothing after it", async () => {
    const answer = deferred<ActionResult<Job>>();
    update.mockReturnValue(answer.promise);
    const { result, name, set, base } = setup();
    name("Run");
    act(() => void result.current.flush());
    await wait(0);
    act(() => result.current.suspend());
    set({ ...base, name: "Run 2" });
    const saved = { ...JOB, about: { name: "Run" }, updated_at: "2026-10-01T12:00:05.000Z" };
    await act(async () => answer.resolve({ ok: true, data: saved }));
    await wait(10_000);
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.current.saved).toBe(saved);
  });

  it("does not note a failure that came after it", async () => {
    const answer = deferred<ActionResult<Job>>();
    update.mockReturnValue(answer.promise);
    const { result, name } = setup();
    name("Run");
    act(() => void result.current.flush());
    await wait(0);
    act(() => result.current.suspend());
    await act(async () => answer.resolve(failure(503)));
    await wait(120_000);
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ kind: "suspended" });
  });
});

describe("resume", () => {
  it("allows saving again and sends nothing by itself: the edit made meanwhile is unsaved until flush", async () => {
    const server = fakeServer();
    update.mockImplementation(server.impl);
    const { result, name } = setup();
    name("Run");
    act(() => result.current.suspend());
    act(() => result.current.resume());
    expect(result.current.state).toEqual({ kind: "unsaved" });
    await wait(60_000);
    expect(update).not.toHaveBeenCalled();

    await save(result);
    expect(patches()).toEqual([{ about: { name: "Run", description: null } }]);
    expect(result.current.state.kind).toBe("saved");
  });

  it("goes back to saved when nothing changed while suspended", async () => {
    const { result } = setup();
    act(() => result.current.suspend());
    expect(result.current.state).toEqual({ kind: "suspended" });
    act(() => result.current.resume());
    expect(result.current.state).toEqual({ kind: "saved", at: JOB.updated_at });
    await wait(10_000);
    expect(update).not.toHaveBeenCalled();
  });

  it("does nothing when it was not suspended", async () => {
    const { result, name } = setup();
    name("Run");
    act(() => result.current.resume());
    await wait(60_000);
    expect(update).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: "unsaved" });
  });

  it("does not undo a halt: a deleted draft stays deleted", async () => {
    update.mockResolvedValue({ ok: false, reason: "not_found" });
    const { result, name } = setup();
    name("Run");
    await save(result);
    expect(result.current.state).toEqual({ kind: "gone" });
    act(() => result.current.suspend());
    act(() => result.current.resume());
    expect(result.current.state).toEqual({ kind: "gone" });
  });
});

describe("disabled", () => {
  it("saves nothing while it is on, flush included, and flush works once it is off", async () => {
    update.mockImplementation(fakeServer().impl);
    const { result, set, base } = setup();
    set({ ...base, name: "Run" }, true);
    await wait(10_000);
    expect(update).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: "suspended" });
    expect(await save(result)).toEqual({ ok: false });
    expect(update).not.toHaveBeenCalled();

    set({ ...base, name: "Run" }, false);
    await wait(10_000);
    expect(update).not.toHaveBeenCalled();
    await save(result);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("owes nothing and so asks nothing: no leave prompt for edits it will not save", async () => {
    const { set, base, result } = setup();
    set({ ...base, name: "Run" }, true);
    expect(prompted()).toBe(false);
    expect(result.current.unsaved).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("the loop breaker", () => {
  it("stops when the server's copy still differs after saving the same change, and says so", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // A server that stores something other than what it was sent.
    update.mockResolvedValue({ ok: true, data: { ...JOB, updated_at: "2026-10-01T12:00:09.000Z" } });
    const { result, name } = setup();
    name("Run");
    await save(result);
    expect(update).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    // Pressing Save again sends nothing either.
    await save(result);
    expect(update).toHaveBeenCalledTimes(1);
    // Nothing is owed, so nothing is claimed to be unsaved.
    expect(result.current.state.kind).toBe("saved");
    expect(prompted()).toBe(false);
  });

  it("is lifted by the next edit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    update.mockResolvedValue({ ok: true, data: { ...JOB, updated_at: "2026-10-01T12:00:09.000Z" } });
    const { result, name } = setup();
    name("Run");
    await save(result);
    name("Run 2");
    expect(result.current.state).toEqual({ kind: "unsaved" });
    await save(result);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("does not stop an ordinary second save of the same value after the baseline changed", async () => {
    const server = fakeServer();
    update.mockImplementation(server.impl);
    const { result, set, base } = setup();
    set({ ...base, name: "Run" });
    await save(result);
    set({ ...base, name: "Run 2" });
    await save(result);
    set({ ...base, name: "Run" });
    await save(result);
    expect(patches().map((p) => p!.about)).toEqual([
      { name: "Run", description: null },
      { name: "Run 2", description: null },
      { name: "Run", description: null },
    ]);
  });
});
