import { describe, expect, it, vi } from "vitest";
import type { ActionResult, Job, DraftUpdateRequest } from "@/lib/jobs/types";
import { fromJob, type DraftContext, type DraftLocal } from "@/lib/workspace/draft-state";
import { createNewDraftSaver, describeNotSaved, SNAPSHOT_GONE } from "@/lib/workspace/save-new-draft";
import { fakeDataset, fakeDraft } from "@/lib/workspace/fixtures";

const dataset = fakeDataset({ runStartAlignment: "year" });
const CTX: DraftContext = { dataset, snapshotState: "found" };

/** The draft the server creates from a snapshot: its defaults, with an id. */
const created = fakeDraft("DRAFT", {
  id: "draft-1",
  dataset_id: dataset.id,
  about: null,
  parameters: {
    temporal_range_start: "2001-01-01",
    temporal_range_end: "2001-12-31",
    spatial_domain: null,
    variables: ["discharge"],
    custom_params: null,
  },
  slurm_config: { cores: null, walltime: null },
  updated_at: "2026-10-01T12:00:00.000Z",
});
/** What the preview showed: the same draft before it has an id. */
const preview: Job = { ...created, id: "" };
const base = (): DraftLocal => fromJob(preview);

const ok = (data: Job): ActionResult<Job> => ({ ok: true, data });
const named = (job: Job, name: string | null, n = 1): Job => ({
  ...job,
  about: name ? { name } : null,
  updated_at: `2026-10-01T12:00:0${n}.000Z`,
});

function deps(over: { derive?: ReturnType<typeof vi.fn>; update?: ReturnType<typeof vi.fn> } = {}) {
  const derive = over.derive ?? vi.fn(async () => ok(created));
  const update =
    over.update ??
    vi.fn(async (_id: string, patch: DraftUpdateRequest) => ok(named(created, patch.about?.name ?? null)));
  return { derive, update, saver: createNewDraftSaver({ derive, update }) };
}

describe("a save that works", () => {
  it("creates the draft from the snapshot, then saves what was changed into it", async () => {
    const { derive, update, saver } = deps();
    const result = await saver.save("snap-1", { ...base(), name: "Run A" }, CTX);

    expect(derive).toHaveBeenCalledTimes(1);
    expect(derive).toHaveBeenCalledWith("snap-1");
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("draft-1", { about: { name: "Run A", description: null } });
    expect(result).toEqual({
      ok: true,
      job: named(created, "Run A"),
      notSaved: [],
      patchError: null,
    });
    expect(saver.created()?.id).toBe("draft-1");
  });

  it("sends nothing when nothing was changed: the server's defaults are the draft", async () => {
    const { derive, update, saver } = deps();
    const result = await saver.save("snap-1", base(), CTX);
    expect(derive).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, job: created, notSaved: [], patchError: null });
  });

  it("is nothing until it is asked: building a saver calls no one", () => {
    const { derive, update } = deps();
    expect(derive).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("a create that fails", () => {
  it("says what the server said, creates nothing and leaves nothing remembered", async () => {
    const derive = vi.fn(async (): Promise<ActionResult<Job>> => ({ ok: false, reason: "error", message: "Backend exploded" }));
    const { update, saver } = deps({ derive });
    const result = await saver.save("snap-1", { ...base(), name: "Run A" }, CTX);
    expect(result).toEqual({ ok: false, failure: { reason: "error", message: "Backend exploded" } });
    expect(update).not.toHaveBeenCalled();
    expect(saver.created()).toBeNull();
  });

  it("separates an ended session, a missing snapshot and a request that threw", async () => {
    const derive = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: "session_expired" })
      .mockResolvedValueOnce({ ok: false, reason: "not_found" })
      .mockRejectedValueOnce(new Error("network down"));
    const { saver } = deps({ derive });
    expect(await saver.save("s", base(), CTX)).toEqual({ ok: false, failure: { reason: "session_expired" } });
    expect(await saver.save("s", base(), CTX)).toEqual({ ok: false, failure: { reason: "error", message: SNAPSHOT_GONE } });
    expect(await saver.save("s", base(), CTX)).toEqual({ ok: false, failure: { reason: "error", message: "network down" } });
  });

  it("tries to create again on the next save, since nothing exists", async () => {
    const derive = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: "error", message: "boom" })
      .mockResolvedValueOnce(ok(created));
    const { saver } = deps({ derive });
    await saver.save("s", base(), CTX);
    const second = await saver.save("s", base(), CTX);
    expect(second.ok).toBe(true);
    expect(derive).toHaveBeenCalledTimes(2);
  });
});

describe("a create that works and a fill that does not", () => {
  it("still reports the draft, with the fields it does not hold and why", async () => {
    const update = vi.fn(async (): Promise<ActionResult<Job>> => ({ ok: false, reason: "error", message: "Server error", status: 500 }));
    const { saver } = deps({ update });
    const local = { ...base(), name: "Run A", description: "why", slurm: { cores: 8, walltime: null } };
    const result = await saver.save("snap-1", local, CTX);
    expect(result).toEqual({
      ok: true,
      job: created,
      notSaved: ["cores", "name", "description"],
      patchError: "Server error",
    });
    // The draft is real and is remembered.
    expect(saver.created()?.id).toBe("draft-1");
    // A 500 is not retried here: the draft exists, and the caller opens it.
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("says so for an ended session, and for a request that threw", async () => {
    const update = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: "session_expired" })
      .mockRejectedValueOnce(new Error("network down"));
    const { saver } = deps({ update });
    const local = { ...base(), name: "Run A" };
    expect(await saver.save("s", local, CTX)).toMatchObject({ ok: true, patchError: "Your session has expired.", notSaved: ["name"] });
    expect(await saver.save("s", local, CTX)).toMatchObject({ ok: true, patchError: "network down", notSaved: ["name"] });
  });

  it("does not create a second draft on a retry: it only sends what still differs", async () => {
    const update = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: "error", message: "Server error", status: 503 })
      .mockImplementationOnce(async (_id: string, patch: DraftUpdateRequest) => ok(named(created, patch.about?.name ?? null)));
    const { derive, saver } = deps({ update });
    const local = { ...base(), name: "Run A" };

    const first = await saver.save("snap-1", local, CTX);
    expect(first).toMatchObject({ ok: true, patchError: "Server error" });
    const second = await saver.save("snap-1", local, CTX);
    expect(second).toEqual({ ok: true, job: named(created, "Run A"), notSaved: [], patchError: null });

    expect(derive).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith("draft-1", { about: { name: "Run A", description: null } });
  });

  it("sends what is left out of a refused group: a start the server refuses does not take the name with it", async () => {
    const update = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        reason: "error",
        message: "Runs of this model must start on January 1.",
        status: 422,
        code: "run_start_not_aligned",
        suggestedStart: "2002-01-01",
      })
      .mockImplementationOnce(async (_id: string, patch: DraftUpdateRequest) => ok(named(created, patch.about?.name ?? null, 2)));
    // The client's own rule is off for this one (no snapshot to check against), so the server decides.
    const local = {
      ...base(),
      name: "Run A",
      parameters: { ...base().parameters, temporal_range_start: "2001-07-01" },
    };
    const { saver } = deps({ update });
    const result = await saver.save("snap-1", local, { dataset: null, snapshotState: "unavailable" });
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0][1]).toHaveProperty("parameters");
    expect(update.mock.calls[1][1]).toEqual({ about: { name: "Run A", description: null } });
    expect(result).toMatchObject({ ok: true, notSaved: ["start"], patchError: null });
  });

  it("withholds a start that does not suit the snapshot, saves the rest, and names the start", async () => {
    const { update, saver } = deps();
    const local = {
      ...base(),
      name: "Run A",
      parameters: { ...base().parameters, temporal_range_start: "2001-07-01" },
    };
    const result = await saver.save("snap-1", local, CTX);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1]).toEqual({ about: { name: "Run A", description: null } });
    expect(result).toMatchObject({ ok: true, notSaved: ["start"], patchError: null });
  });
});

describe("saves that overlap", () => {
  it("run one after the other, so only one of them creates the draft", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const derive = vi.fn(async () => {
      await gate;
      return ok(created);
    });
    const { update, saver } = deps({ derive });
    const local = { ...base(), name: "Run A" };

    const a = saver.save("snap-1", local, CTX);
    const b = saver.save("snap-1", local, CTX);
    release();
    const [first, second] = await Promise.all([a, b]);

    expect(derive).toHaveBeenCalledTimes(1);
    // The second found the draft already holding the name: nothing left to send.
    expect(update).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ ok: true, notSaved: [] });
    expect(second).toMatchObject({ ok: true, notSaved: [] });
  });

  it("carry on after one that failed", async () => {
    const derive = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(ok(created));
    const { saver } = deps({ derive });
    const [a, b] = await Promise.all([saver.save("s", base(), CTX), saver.save("s", base(), CTX)]);
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(true);
  });
});

describe("describeNotSaved", () => {
  it("says the draft exists and which settings are missing, in the wizard's words", () => {
    expect(describeNotSaved(["start", "cores"])).toBe(
      "The draft was saved, but these settings weren't: Start date, Cores. Open it to set them again."
    );
  });
});
