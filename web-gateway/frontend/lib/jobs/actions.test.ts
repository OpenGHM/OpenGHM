import { beforeEach, describe, expect, it, vi } from "vitest";

const { patch, post, getApiClient } = vi.hoisted(() => {
  const patch = vi.fn();
  const post = vi.fn();
  return { patch, post, getApiClient: vi.fn(async () => ({ patch, post })) };
});
vi.mock("@/lib/api-client", () => ({ getApiClient }));

import { duplicateSimulation, updateSimulation } from "./actions";

beforeEach(() => {
  patch.mockReset();
  post.mockReset();
});

/** What axios throws for a response that is not a 2xx. */
const refused = (status: number, detail?: unknown) => ({ response: { status, data: { detail } } });

describe("a failed PATCH, read by describeFailure", () => {
  it("reads pydantic's array detail: the first message, and the fields as dotted paths without body", async () => {
    patch.mockRejectedValue(
      refused(422, [
        { loc: ["body", "slurm_config", "walltime"], msg: "Value error, walltime must be HH:MM:SS", type: "value_error" },
        { loc: ["body", "slurm_config", "cores"], msg: "Input should be less than or equal to 128", type: "less_than_equal" },
      ])
    );
    await expect(updateSimulation("j", {})).resolves.toEqual({
      ok: false,
      reason: "error",
      message: "Value error, walltime must be HH:MM:SS",
      status: 422,
      fields: ["slurm_config.walltime", "slurm_config.cores"],
    });
  });

  it("joins an index into the path and names each field once", async () => {
    patch.mockRejectedValue(
      refused(422, [
        { loc: ["body", "parameters", "variables", 0], msg: "a" },
        { loc: ["body", "parameters", "variables", 0], msg: "b" },
        { loc: ["body", "parameters"], msg: "c" },
      ])
    );
    const result = await updateSimulation("j", {});
    expect(result).toMatchObject({ ok: false, reason: "error", message: "a", fields: ["parameters.variables.0", "parameters"] });
  });

  it("keeps a path that does not start with body, and skips an entry that names nothing", async () => {
    patch.mockRejectedValue(
      refused(422, [{ msg: "no location" }, { loc: [], msg: "empty" }, { loc: ["query", "page"], msg: "bad page" }, null, "text"])
    );
    const result = await updateSimulation("j", {});
    expect(result).toMatchObject({ message: "no location", fields: ["query.page"] });
  });

  it("falls back to the error's own words when the array holds no message", async () => {
    patch.mockRejectedValue(refused(422, []));
    const result = await updateSimulation("j", {});
    expect(result).toMatchObject({ ok: false, reason: "error", message: "Request failed.", status: 422 });
    expect(result).not.toHaveProperty("fields", expect.anything());
  });

  it("still reads a plain string detail", async () => {
    patch.mockRejectedValue(refused(500, "Internal error"));
    await expect(updateSimulation("j", {})).resolves.toMatchObject({ message: "Internal error", status: 500 });
  });

  it("still reads { code, message } and the fields of an unsupported_fields refusal", async () => {
    patch.mockRejectedValue(
      refused(422, { code: "unsupported_fields", message: "Cannot run yet", fields: ["parameters.spatial_domain"] })
    );
    await expect(updateSimulation("j", {})).resolves.toMatchObject({
      message: "Cannot run yet",
      code: "unsupported_fields",
      fields: ["parameters.spatial_domain"],
      status: 422,
    });
  });

  it("reads the suggested start of a run_start_not_aligned refusal", async () => {
    patch.mockRejectedValue(
      refused(422, { code: "run_start_not_aligned", message: "Start on January 1.", suggested_start: "2001-01-01" })
    );
    await expect(updateSimulation("j", {})).resolves.toMatchObject({
      code: "run_start_not_aligned",
      message: "Start on January 1.",
      suggestedStart: "2001-01-01",
    });
  });

  it("answers 401 as an ended session and 404 as not found", async () => {
    patch.mockRejectedValueOnce(refused(401));
    await expect(updateSimulation("j", {})).resolves.toEqual({ ok: false, reason: "session_expired" });
    patch.mockRejectedValueOnce(refused(404));
    await expect(updateSimulation("j", {})).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("answers a 409 not_a_draft with its code", async () => {
    patch.mockRejectedValue(refused(409, { code: "not_a_draft", message: "Only a draft can be edited." }));
    await expect(updateSimulation("j", {})).resolves.toMatchObject({ status: 409, code: "not_a_draft" });
  });

  it("answers a failure with no response as the error's message, without a status", async () => {
    patch.mockRejectedValue(new Error("timeout of 10000ms exceeded"));
    const result = await updateSimulation("j", {});
    expect(result).toMatchObject({ ok: false, reason: "error", message: "timeout of 10000ms exceeded" });
    expect(result).toHaveProperty("status", undefined);
  });
});

describe("duplicateSimulation", () => {
  it("POSTs to the job's duplicate route and returns the new draft", async () => {
    const draft = { id: "new-1", status: "DRAFT" };
    post.mockResolvedValue({ data: draft });
    await expect(duplicateSimulation("job/1")).resolves.toEqual({ ok: true, data: draft });
    expect(post).toHaveBeenCalledWith("/api/v1/jobs/job%2F1/duplicate");
  });

  it("answers a gone snapshot with its code and message", async () => {
    post.mockRejectedValue(
      refused(422, { code: "snapshot_not_found", message: "The model snapshot is no longer in the repository." })
    );
    await expect(duplicateSimulation("j")).resolves.toMatchObject({
      ok: false,
      reason: "error",
      code: "snapshot_not_found",
      message: "The model snapshot is no longer in the repository.",
    });
  });

  it("answers 404 as not found and 401 as an ended session", async () => {
    post.mockRejectedValueOnce(refused(404, "Job not found"));
    await expect(duplicateSimulation("j")).resolves.toEqual({ ok: false, reason: "not_found" });
    post.mockRejectedValueOnce(refused(401));
    await expect(duplicateSimulation("j")).resolves.toEqual({ ok: false, reason: "session_expired" });
  });
});
