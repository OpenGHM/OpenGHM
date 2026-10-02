import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ActionResult, Job, PartialAbout, SimulationUpdateRequest } from "@/lib/jobs/types";

vi.mock("@/lib/jobs/actions", () => ({ updateSimulation: vi.fn() }));

import { updateSimulation } from "@/lib/jobs/actions";
import { clearDraftCache, readDraftCache } from "@/lib/workspace/draft-cache";
import { fromJob, type DraftContext, type DraftLocal } from "@/lib/workspace/draft-state";
import { RETRY_DELAYS_MS, useDraftAutosave } from "@/lib/workspace/use-draft-autosave";
import { fakeDataset, fakeSimulation } from "@/lib/workspace/fixtures";

const update = vi.mocked(updateSimulation);

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

const JOB = fakeSimulation("DRAFT", {
  id: "job-1",
  updated_at: "2026-10-01T12:00:00.000Z",
  parameters: {
    temporal_range_start: "2001-01-01",
    temporal_range_end: "2003-12-31",
    spatial_domain: null,
    variables: ["discharge", "runoff"],
    custom_params: null,
  },
  slurm_config: { cores: null, walltime: null },
});

/** What the backend does with a PATCH, as far as these tests need. */
function fakeServer(initial: Job = JOB) {
  let current = initial;
  let n = 0;
  return {
    get current() {
      return current;
    },
    impl: async (_id: string, patch: SimulationUpdateRequest): Promise<ActionResult<Job>> => {
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

function setup(job: Job = JOB, ctx: DraftContext = FOUND, options: { debounceMs?: number } = {}) {
  const hook = renderHook(
    (props: { local: DraftLocal; disabled?: boolean }) =>
      useDraftAutosave({ jobId: job.id, initialSaved: job, ctx, ...options, ...props }),
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
  it("saves nothing on mount, however long it waits", async () => {
    const server = fakeServer();
    update.mockImplementation(server.impl);
    const { result } = setup();
    await wait(60_000);
    expect(update).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: "saved", at: JOB.updated_at });
    expect(result.current.saved).toBe(JOB);
  });

  it("saves nothing for a draft whose variables are stored in another order than the snapshot's", async () => {
    const job = { ...JOB, parameters: { ...JOB.parameters, variables: ["runoff", "discharge"] } };
    setup(job);
    await wait(10_000);
    expect(update).not.toHaveBeenCalled();
  });

  it("saves nothing when the same local copy is passed again as a new object", async () => {
    const { rerender } = setup();
    rerender({ local: fromJob(JOB) });
    await wait(10_000);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("the pause", () => {
  it("coalesces rapid edits into one PATCH, 800 ms after the last", async () => {
    const server = fakeServer();
    update.mockImplementation(server.impl);
    const { result, name } = setup();

    name("R");
    await wait(300);
    name("Ru");
    await wait(300);
    name("Run");
    expect(result.current.state).toEqual({ kind: "saving" });
    await wait(799);
    expect(update).not.toHaveBeenCalled();
    await wait(1);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("job-1", { about: { name: "Run", description: null } });
    expect(result.current.state).toEqual({ kind: "saved", at: server.current.updated_at });
    await wait(10_000);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("honours another pause", async () => {
    update.mockImplementation(fakeServer().impl);
    const { name } = setup(JOB, FOUND, { debounceMs: 100 });
    name("Run");
    await wait(99);
    expect(update).not.toHaveBeenCalled();
    await wait(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for an edit that was undone before the pause ended", async () => {
    update.mockImplementation(fakeServer().impl);
    const { name, result } = setup();
    name("Run");
    await wait(400);
    name("");
    await wait(5_000);
    expect(update).not.toHaveBeenCalled();
    expect(result.current.state.kind).toBe("saved");
  });

  it("saves the groups an edit touched and no others", async () => {
    update.mockImplementation(fakeServer().impl);
    const { set, base } = setup();
    set(withCores(base, 4));
    await wait(800);
    expect(patches()).toEqual([{ slurm_config: { cores: 4, walltime: null } }]);
  });

  it("remembers the saved job for the back/forward cache", async () => {
    const server = fakeServer();
    update.mockImplementation(server.impl);
    const { name } = setup();
    name("Run");
    await wait(800);
    expect(readDraftCache("job-1")).toBe(server.current);
  });
});

describe("one request at a time", () => {
  it("sends an edit made during a save afterwards, from the answer as the new baseline, and never writes the answer over the local copy", async () => {
    const first = deferred<ActionResult<Job>>();
    const server = fakeServer();
    update.mockImplementationOnce(async (id, patch) => {
      await server.impl(id, patch);
      return first.promise;
    });
    update.mockImplementation(server.impl);
    const { result, set, base, name } = setup();

    name("Run");
    await wait(800);
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ kind: "saving" });

    // Typed while the first request is out.
    set({ ...base, name: "Run 2", slurm: { cores: 8, walltime: null } });
    await wait(800);
    expect(update).toHaveBeenCalledTimes(1);

    // The answer is a name the person has already changed.
    first.resolve({ ok: true, data: { ...server.current, about: { name: "Run" } } });
    await wait(0);
    expect(update).toHaveBeenCalledTimes(2);
    expect(patches()[1]).toEqual({
      about: { name: "Run 2", description: null },
      slurm_config: { cores: 8, walltime: null },
    });
    expect(result.current.state.kind).toBe("saved");
    expect(server.current.about).toEqual({ name: "Run 2" });
  });

  it("holds a change made during a save for its own pause when that is still running", async () => {
    const first = deferred<ActionResult<Job>>();
    const server = fakeServer();
    update.mockImplementationOnce(async (id, patch) => {
      await server.impl(id, patch);
      return first.promise;
    });
    update.mockImplementation(server.impl);
    const { set, base, name } = setup();

    name("Run");
    await wait(800);
    set({ ...base, name: "Run 2" });
    await wait(100);
    first.resolve({ ok: true, data: server.current });
    await wait(0);
    expect(update).toHaveBeenCalledTimes(1);
    await wait(699);
    expect(update).toHaveBeenCalledTimes(1);
    await wait(1);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("never has two requests out at once", async () => {
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
    const { set, base } = setup();

    set({ ...base, name: "a" });
    await wait(800);
    set({ ...base, name: "ab" });
    await wait(5_000);
    expect(update).toHaveBeenCalledTimes(1);

    answers[0].resolve({ ok: true, data: { ...JOB, about: { name: "a" }, updated_at: "2026-10-01T12:00:01.000Z" } });
    await wait(0);
    expect(update).toHaveBeenCalledTimes(2);
    answers[1].resolve({ ok: true, data: { ...JOB, about: { name: "ab" }, updated_at: "2026-10-01T12:00:02.000Z" } });
    await wait(0);
    expect(most).toBe(1);
  });
});

describe("flush", () => {
  it("saves at once without waiting for the pause, and says what the saved job holds", async () => {
    const server = fakeServer();
    update.mockImplementation(server.impl);
    const { result, name } = setup();
    name("Run");

    let flushed!: Awaited<ReturnType<typeof result.current.flush>>;
    await act(async () => {
      flushed = await result.current.flush();
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(flushed).toEqual({ ok: true, job: server.current, withheld: [] });
    await wait(10_000);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("resolves with no request when nothing is owed", async () => {
    const { result } = setup();
    let flushed!: Awaited<ReturnType<typeof result.current.flush>>;
    await act(async () => {
      flushed = await result.current.flush();
    });
    expect(update).not.toHaveBeenCalled();
    expect(flushed).toEqual({ ok: true, job: JOB, withheld: [] });
  });

  it("waits for a request that is out, and for the edit made behind it", async () => {
    const first = deferred<ActionResult<Job>>();
    const server = fakeServer();
    update.mockImplementationOnce(async (id, patch) => {
      await server.impl(id, patch);
      return first.promise;
    });
    update.mockImplementation(server.impl);
    const { result, set, base, name } = setup();

    name("Run");
    await wait(800);
    set({ ...base, name: "Run 2" });

    let done = false;
    let flushed: unknown;
    act(() => {
      void result.current.flush().then((r) => {
        done = true;
        flushed = r;
      });
    });
    await wait(0);
    expect(done).toBe(false);

    first.resolve({ ok: true, data: server.current });
    await wait(0);
    expect(done).toBe(true);
    expect(update).toHaveBeenCalledTimes(2);
    expect(flushed).toMatchObject({ ok: true, job: { about: { name: "Run 2" } } });
  });

  it("lists what the saved job does not hold", async () => {
    update.mockImplementation(fakeServer().impl);
    const { result, set, base } = setup();
    set({ ...withCores(base, 0), name: "Run" });
    let flushed!: Awaited<ReturnType<typeof result.current.flush>>;
    await act(async () => {
      flushed = await result.current.flush();
    });
    expect(patches()).toEqual([{ about: { name: "Run", description: null } }]);
    expect(flushed).toMatchObject({ ok: true, withheld: ["cores"] });
  });

  it("is not ok when the save did not go through", async () => {
    update.mockResolvedValue(failure(503));
    const { result, name } = setup();
    name("Run");
    let flushed!: Awaited<ReturnType<typeof result.current.flush>>;
    await act(async () => {
      flushed = await result.current.flush();
    });
    expect(flushed).toEqual({ ok: false });
  });

  it("is saved when the page is hidden", async () => {
    update.mockImplementation(fakeServer().impl);
    const { name } = setup();
    name("Run");
    const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(update).toHaveBeenCalledTimes(1);
    state.mockRestore();
  });

  it("is saved on pagehide, and on unmount", async () => {
    update.mockImplementation(fakeServer().impl);
    const first = setup();
    first.name("Run");
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(update).toHaveBeenCalledTimes(1);

    update.mockClear();
    const second = setup();
    second.name("Run");
    await act(async () => {
      second.unmount();
    });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("leaves no timer behind when it unmounts with nothing owed", async () => {
    update.mockImplementation(fakeServer().impl);
    const { name, unmount } = setup();
    name("Run");
    await wait(800);
    update.mockClear();
    unmount();
    await wait(60_000);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("what the server answers", () => {
  it("ok: the answer is the baseline, and the state says when it was saved", async () => {
    const server = fakeServer();
    update.mockImplementation(server.impl);
    const { result, name } = setup();
    name("Run");
    await wait(800);
    expect(result.current.saved).toBe(server.current);
    expect(result.current.state).toEqual({ kind: "saved", at: server.current.updated_at });
    expect(result.current.saved.updated_at).not.toBe(JOB.updated_at);
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
      await wait(800);

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
      await wait(800);
      // Nothing else to send: the refused start stays withheld and costs nothing.
      expect(update).toHaveBeenCalledTimes(1);
      await wait(60_000);
      expect(update).toHaveBeenCalledTimes(1);
      expect(result.current.startRefusal).not.toBeNull();

      set(withStart("2002-01-01"));
      expect(result.current.startRefusal).toBeNull();
      expect(result.current.serverErrors.start).toBeUndefined();
      await wait(800);
      expect(update).toHaveBeenCalledTimes(2);
      expect(patches()[1]!.parameters).toMatchObject({ temporal_range_start: "2002-01-01" });
      expect(result.current.state.kind).toBe("saved");
    });

    it("does not loop when the server refuses a start that was not changed", async () => {
      update.mockResolvedValue(refusal);
      const { result, set, base } = setup(JOB, UNCHECKED);
      set({ ...base, parameters: { ...base.parameters, temporal_range_end: "2002-12-31" } });
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
      await wait(800);

      expect(patches()).toEqual([
        { slurm_config: { cores: 99, walltime: null }, about: { name: "Run", description: null } },
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
      await wait(800);
      expect(result.current.state.kind).toBe("refused");

      set(withCores(base, 64));
      await wait(800);
      expect(patches()[1]).toEqual({ slurm_config: { cores: 64, walltime: null } });
      expect(result.current.state.kind).toBe("saved");
      expect(result.current.serverErrors).toEqual({});
    });

    it("an answer that names no field withholds everything that was sent", async () => {
      update.mockResolvedValue(failure(422, { message: "no" }));
      const { result, set, base } = setup();
      set({ ...withCores(base, 4), name: "Run" });
      await wait(10_000);
      expect(update).toHaveBeenCalledTimes(1);
      expect(result.current.withheld).toEqual(["cores", "walltime", "name", "description"]);
    });

    it("a 403 is refused too and not retried", async () => {
      update.mockResolvedValue(failure(403));
      const { result, name } = setup();
      name("Run");
      await wait(120_000);
      expect(update).toHaveBeenCalledTimes(1);
      expect(result.current.state.kind).toBe("refused");
    });
  });

  it("401: stops, keeps the local copy, says the session ended, and sends nothing more", async () => {
    update.mockResolvedValue({ ok: false, reason: "session_expired" });
    const { result, name, set, base } = setup();
    name("Run");
    await wait(800);
    expect(result.current.state).toEqual({ kind: "session-expired" });

    set({ ...base, name: "Run 2" });
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
    await wait(800);
    await act(async () => result.current.retry());
    expect(update).toHaveBeenCalledTimes(2);
    expect(result.current.state.kind).toBe("saved");
  });

  it("409: stops with a conflict, which retry() does not clear", async () => {
    update.mockResolvedValue(failure(409, { code: "not_a_draft", message: "Only a draft can be edited." }));
    const { result, name, set, base } = setup();
    name("Run");
    await wait(800);
    expect(result.current.state).toEqual({ kind: "conflict" });

    set({ ...base, name: "Run 2" });
    await wait(60_000);
    await act(async () => result.current.retry());
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ kind: "conflict" });
  });

  it("404: stops, the draft is gone", async () => {
    update.mockResolvedValue({ ok: false, reason: "not_found" });
    const { result, name } = setup();
    name("Run");
    await wait(800);
    expect(result.current.state).toEqual({ kind: "gone" });
    await wait(120_000);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("no answer, a 5xx, a timeout", () => {
  it("retries after 2, 4, 8, 16 and 30 seconds, then reports a failure", async () => {
    expect([...RETRY_DELAYS_MS]).toEqual([2_000, 4_000, 8_000, 16_000, 30_000]);
    update.mockResolvedValue(failure(503));
    const { result, name } = setup();
    name("Run");
    await wait(800);
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ kind: "retrying", attempt: 1 });

    let calls = 1;
    for (const [i, delay] of [2_000, 4_000, 8_000, 16_000, 30_000].entries()) {
      await wait(delay - 1);
      expect(update).toHaveBeenCalledTimes(calls);
      await wait(1);
      calls += 1;
      expect(update).toHaveBeenCalledTimes(calls);
      if (i < 4) expect(result.current.state).toEqual({ kind: "retrying", attempt: i + 2 });
    }

    expect(result.current.state).toEqual({ kind: "failed", message: "failed 503" });
    await wait(300_000);
    expect(update).toHaveBeenCalledTimes(6);
  });

  it("treats a request that throws, and one with no status, the same way", async () => {
    update.mockRejectedValueOnce(new Error("network down"));
    update.mockResolvedValueOnce(failure(undefined));
    update.mockImplementation(fakeServer().impl);
    const { result, name } = setup();
    name("Run");
    await wait(800);
    expect(result.current.state).toEqual({ kind: "retrying", attempt: 1 });
    await wait(2_000);
    expect(result.current.state).toEqual({ kind: "retrying", attempt: 2 });
    await wait(4_000);
    expect(update).toHaveBeenCalledTimes(3);
    expect(result.current.state.kind).toBe("saved");
  });

  it("retries a 408 and a 429", async () => {
    update.mockResolvedValueOnce(failure(429));
    update.mockResolvedValueOnce(failure(408));
    update.mockImplementation(fakeServer().impl);
    const { result, name } = setup();
    name("Run");
    await wait(800 + 2_000 + 4_000);
    expect(update).toHaveBeenCalledTimes(3);
    expect(result.current.state.kind).toBe("saved");
  });

  it("recovers: a later success clears the failure and the count starts again", async () => {
    update.mockResolvedValueOnce(failure(503));
    update.mockImplementation(fakeServer().impl);
    const { result, name } = setup();
    name("Run");
    await wait(800 + 2_000);
    expect(result.current.state.kind).toBe("saved");
    update.mockResolvedValueOnce(failure(503));
    name("Run again");
    await wait(800);
    expect(result.current.state).toEqual({ kind: "retrying", attempt: 1 });
  });

  it("retry() tries at once after a failure and counts from the start", async () => {
    update.mockResolvedValue(failure(503));
    const { result, name } = setup();
    name("Run");
    await wait(800 + 2_000 + 4_000 + 8_000 + 16_000 + 30_000);
    expect(result.current.state.kind).toBe("failed");
    expect(update).toHaveBeenCalledTimes(6);

    update.mockImplementation(fakeServer().impl);
    await act(async () => result.current.retry());
    expect(update).toHaveBeenCalledTimes(7);
    expect(result.current.state.kind).toBe("saved");
  });

  it("the next edit saves after its own pause instead of waiting out the back-off", async () => {
    update.mockResolvedValueOnce(failure(503));
    update.mockImplementation(fakeServer().impl);
    const { result, set, base } = setup();
    set({ ...base, name: "Run" });
    await wait(800);
    expect(update).toHaveBeenCalledTimes(1);

    set({ ...base, name: "Run 2" });
    expect(result.current.state).toEqual({ kind: "saving" });
    await wait(800);
    expect(update).toHaveBeenCalledTimes(2);
    expect(patches()[1]).toMatchObject({ about: { name: "Run 2" } });
    expect(result.current.state.kind).toBe("saved");
    await wait(60_000);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("going back online tries at once", async () => {
    update.mockResolvedValueOnce(failure(undefined));
    update.mockImplementation(fakeServer().impl);
    const { result, name } = setup();
    name("Run");
    await wait(800);
    expect(update).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(update).toHaveBeenCalledTimes(2);
    expect(result.current.state.kind).toBe("saved");
    await wait(60_000);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("going online with nothing wrong sends nothing", async () => {
    setup();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("beforeunload", () => {
  const prompted = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it("is asked for only while something is unsaved", async () => {
    update.mockImplementation(fakeServer().impl);
    const { name } = setup();
    expect(prompted()).toBe(false);

    name("Run");
    expect(prompted()).toBe(true);
    await wait(800);
    expect(prompted()).toBe(false);
  });

  it("is asked for while a request is out", async () => {
    const answer = deferred<ActionResult<Job>>();
    update.mockReturnValue(answer.promise);
    const { name } = setup();
    name("Run");
    await wait(800);
    expect(prompted()).toBe(true);
    answer.resolve({ ok: true, data: { ...JOB, about: { name: "Run" }, updated_at: "2026-10-01T12:00:05.000Z" } });
    await wait(0);
    expect(prompted()).toBe(false);
  });

  it("is asked for while a value is withheld, and while a save is failing", async () => {
    update.mockImplementation(fakeServer().impl);
    const { set, base } = setup();
    set(withCores(base, 0));
    await wait(800);
    expect(update).not.toHaveBeenCalled();
    expect(prompted()).toBe(true);
    set(withCores(base, 4));
    await wait(800);
    expect(prompted()).toBe(false);
  });

  it("is asked for after a failure and not once saved again", async () => {
    update.mockResolvedValueOnce(failure(503));
    update.mockImplementation(fakeServer().impl);
    const { name } = setup();
    name("Run");
    await wait(800);
    expect(prompted()).toBe(true);
    await wait(2_000);
    expect(prompted()).toBe(false);
  });

  it("is not added when the hook unmounts", async () => {
    const { name, unmount } = setup();
    name("Run");
    expect(prompted()).toBe(true);
    unmount();
    expect(prompted()).toBe(false);
  });
});

describe("suspend", () => {
  it("stops all saving, including an edit that was waiting for its pause", async () => {
    update.mockImplementation(fakeServer().impl);
    const { result, name, set, base } = setup();
    name("Run");
    act(() => result.current.suspend());
    await wait(10_000);
    expect(update).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: "suspended" });

    set({ ...base, name: "Run 2" });
    await wait(10_000);
    expect(update).not.toHaveBeenCalled();
  });

  it("flush no longer saves, and the page stops asking before leaving", async () => {
    const { result, name } = setup();
    name("Run");
    act(() => result.current.suspend());
    let flushed!: Awaited<ReturnType<typeof result.current.flush>>;
    await act(async () => {
      flushed = await result.current.flush();
    });
    expect(flushed).toEqual({ ok: false });
    expect(update).not.toHaveBeenCalled();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("lets a request that is out finish, and sends nothing after it", async () => {
    const answer = deferred<ActionResult<Job>>();
    update.mockReturnValue(answer.promise);
    const { result, name, set, base } = setup();
    name("Run");
    await wait(800);
    act(() => result.current.suspend());
    set({ ...base, name: "Run 2" });
    const saved = { ...JOB, about: { name: "Run" }, updated_at: "2026-10-01T12:00:05.000Z" };
    answer.resolve({ ok: true, data: saved });
    await wait(10_000);
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.current.saved).toBe(saved);
  });

  it("does not retry a save that failed after it", async () => {
    const answer = deferred<ActionResult<Job>>();
    update.mockReturnValue(answer.promise);
    const { result, name } = setup();
    name("Run");
    await wait(800);
    act(() => result.current.suspend());
    answer.resolve(failure(503));
    await wait(120_000);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("does not unmount-save either", async () => {
    const { result, name, unmount } = setup();
    name("Run");
    act(() => result.current.suspend());
    unmount();
    await wait(1_000);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("disabled", () => {
  it("saves nothing while it is on, and the edits made meanwhile when it goes off", async () => {
    update.mockImplementation(fakeServer().impl);
    const { result, set, base } = setup();
    set({ ...base, name: "Run" }, true);
    await wait(10_000);
    expect(update).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ kind: "suspended" });

    set({ ...base, name: "Run" }, false);
    await wait(800);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("the loop breaker", () => {
  it("stops when the server's copy still differs after saving the same change, and says so", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // A server that stores something other than what it was sent.
    update.mockResolvedValue({ ok: true, data: { ...JOB, updated_at: "2026-10-01T12:00:09.000Z" } });
    const { result, name } = setup();
    name("Run");
    await wait(800);
    expect(update).toHaveBeenCalledTimes(1);
    await wait(60_000);
    expect(update).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    // Nothing is owed, so nothing is claimed to be saving or unsaved.
    expect(result.current.state.kind).toBe("saved");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("is lifted by the next edit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    update.mockResolvedValue({ ok: true, data: { ...JOB, updated_at: "2026-10-01T12:00:09.000Z" } });
    const { result, name } = setup();
    name("Run");
    await wait(800);
    name("Run 2");
    expect(result.current.state).toEqual({ kind: "saving" });
    await wait(800);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("does not stop an ordinary second save of the same value after the baseline changed", async () => {
    const server = fakeServer();
    update.mockImplementation(server.impl);
    const { set, base } = setup();
    set({ ...base, name: "Run" });
    await wait(800);
    set({ ...base, name: "Run 2" });
    await wait(800);
    set({ ...base, name: "Run" });
    await wait(800);
    expect(patches().map((p) => p!.about)).toEqual([
      { name: "Run", description: null },
      { name: "Run 2", description: null },
      { name: "Run", description: null },
    ]);
  });
});
