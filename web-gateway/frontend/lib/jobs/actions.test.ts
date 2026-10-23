import { beforeEach, describe, expect, it, vi } from "vitest";

const { patch, post, get, del, getApiClient } = vi.hoisted(() => {
  const patch = vi.fn();
  const post = vi.fn();
  const get = vi.fn();
  const del = vi.fn();
  return { patch, post, get, del, getApiClient: vi.fn<(options?: unknown) => Promise<unknown>>(async () => ({ patch, post, get, delete: del })) };
});
vi.mock("@/lib/api-client", () => ({ getApiClient }));

import { AxiosError } from "axios";
import {
  BACKEND_TIMEOUT_MESSAGE,
  BACKEND_UNREACHABLE_MESSAGE,
  SERVER_ERROR_MESSAGE,
} from "@/lib/action-failure";
import { cancelJob, deleteDraft, duplicateDraft, pollJobStatus, publishDraft, publishedAnswer, submitDraft, updateDraft } from "./actions";

beforeEach(() => {
  patch.mockReset();
  post.mockReset();
  get.mockReset();
  del.mockReset();
  getApiClient.mockClear();
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
    await expect(updateDraft("j", {})).resolves.toEqual({
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
    const result = await updateDraft("j", {});
    expect(result).toMatchObject({ ok: false, reason: "error", message: "a", fields: ["parameters.variables.0", "parameters"] });
  });

  it("keeps a path that does not start with body, and skips an entry that names nothing", async () => {
    patch.mockRejectedValue(
      refused(422, [{ msg: "no location" }, { loc: [], msg: "empty" }, { loc: ["query", "page"], msg: "bad page" }, null, "text"])
    );
    const result = await updateDraft("j", {});
    expect(result).toMatchObject({ message: "no location", fields: ["query.page"] });
  });

  it("falls back to the error's own words when the array holds no message", async () => {
    patch.mockRejectedValue(refused(422, []));
    const result = await updateDraft("j", {});
    expect(result).toMatchObject({ ok: false, reason: "error", message: "Request failed.", status: 422 });
    expect(result).not.toHaveProperty("fields", expect.anything());
  });

  it("still reads a plain string detail", async () => {
    patch.mockRejectedValue(refused(500, "Internal error"));
    await expect(updateDraft("j", {})).resolves.toMatchObject({ message: "Internal error", status: 500 });
  });

  it("still reads { code, message } and the fields of an unsupported_fields refusal", async () => {
    patch.mockRejectedValue(
      refused(422, { code: "unsupported_fields", message: "Cannot run yet", fields: ["parameters.spatial_domain"] })
    );
    await expect(updateDraft("j", {})).resolves.toMatchObject({
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
    await expect(updateDraft("j", {})).resolves.toMatchObject({
      code: "run_start_not_aligned",
      message: "Start on January 1.",
      suggestedStart: "2001-01-01",
    });
  });

  it("answers 401 as an ended session and 404 as not found", async () => {
    patch.mockRejectedValueOnce(refused(401));
    await expect(updateDraft("j", {})).resolves.toEqual({ ok: false, reason: "session_expired" });
    patch.mockRejectedValueOnce(refused(404));
    await expect(updateDraft("j", {})).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("answers a 409 not_a_draft with its code", async () => {
    patch.mockRejectedValue(refused(409, { code: "not_a_draft", message: "Only a draft can be edited." }));
    await expect(updateDraft("j", {})).resolves.toMatchObject({ status: 409, code: "not_a_draft" });
  });

  it("answers a failure with no response and no axios in it as the error's own message, without a status", async () => {
    patch.mockRejectedValue(new Error("something odd"));
    const result = await updateDraft("j", {});
    expect(result).toMatchObject({ ok: false, reason: "error", message: "something odd" });
    expect(result).toHaveProperty("status", undefined);
  });
});

describe("a call that gets no answer, read by describeFailure", () => {
  // Node 26 with axios 1.13.6: a refused connection is an AxiosError whose message is "".
  const refusedConnection = () => new AxiosError("", "ECONNREFUSED");

  it("says the gateway's server could not be reached when the connection is refused (empty message)", async () => {
    post.mockRejectedValue(refusedConnection());
    const result = await submitDraft("j");
    expect(result).toMatchObject({
      ok: false,
      reason: "error",
      code: "backend_unreachable",
      message: BACKEND_UNREACHABLE_MESSAGE,
    });
    expect(result).toHaveProperty("status", undefined);
    expect(BACKEND_UNREACHABLE_MESSAGE).toMatch(/Nothing was changed/);
  });

  it("treats an empty message as missing even from a plain Error", async () => {
    post.mockRejectedValue(new Error(""));
    await expect(duplicateDraft("j")).resolves.toMatchObject({ code: "backend_unreachable", message: BACKEND_UNREACHABLE_MESSAGE });
  });

  it("never answers with an empty message, whichever action it was", async () => {
    post.mockRejectedValue(refusedConnection());
    del.mockRejectedValue(refusedConnection());
    patch.mockRejectedValue(refusedConnection());
    const results = await Promise.all([submitDraft("j"), cancelJob("j"), deleteDraft("j"), duplicateDraft("j"), updateDraft("j", {})]);
    for (const result of results) {
      expect(result).toMatchObject({ ok: false, reason: "error", code: "backend_unreachable" });
      expect((result as { message: string }).message.length).toBeGreaterThan(0);
    }
  });

  it("words a timeout as no answer yet, which may still have gone through", async () => {
    post.mockRejectedValue(new AxiosError("timeout of 60000ms exceeded", "ECONNABORTED"));
    const result = await submitDraft("j");
    expect(result).toMatchObject({ ok: false, reason: "error", code: "backend_timeout", message: BACKEND_TIMEOUT_MESSAGE });
    expect(BACKEND_TIMEOUT_MESSAGE).toMatch(/may still have gone through/);
    expect(BACKEND_TIMEOUT_MESSAGE).toMatch(/Reload the page/);
  });

  it("recognises a timeout by its message when it carries no code", async () => {
    patch.mockRejectedValue(new Error("timeout of 10000ms exceeded"));
    await expect(updateDraft("j", {})).resolves.toMatchObject({ code: "backend_timeout", message: BACKEND_TIMEOUT_MESSAGE });
  });
});

describe("a 5xx, read by describeFailure", () => {
  const axios500 = (status: number, detail?: unknown) =>
    Object.assign(new AxiosError(`Request failed with status code ${status}`), { response: { status, data: { detail } } });

  it.each([500, 502, 503, 504])("is a fixed sentence for a %i with no message of its own, never axios's words", async (status) => {
    del.mockRejectedValue(axios500(status));
    const result = await deleteDraft("j");
    expect(result).toMatchObject({ ok: false, reason: "error", status, code: "server_error", message: SERVER_ERROR_MESSAGE });
    expect((result as { message: string }).message).not.toMatch(/status code/);
  });

  it("is a fixed sentence for a 5xx whose detail is an empty string, or an HTML error page", async () => {
    del.mockRejectedValueOnce(axios500(500, ""));
    await expect(deleteDraft("j")).resolves.toMatchObject({ message: SERVER_ERROR_MESSAGE });
    del.mockRejectedValueOnce(Object.assign(new AxiosError("Request failed with status code 502"), { response: { status: 502, data: "<html>Bad gateway</html>" } }));
    await expect(deleteDraft("j")).resolves.toMatchObject({ message: SERVER_ERROR_MESSAGE });
  });

  it("keeps the backend's own sentence for a 5xx that has one", async () => {
    del.mockRejectedValue(axios500(502, { code: "cleanup_failed", message: "Anvil could not remove the directories." }));
    await expect(deleteDraft("j")).resolves.toMatchObject({
      status: 502,
      code: "cleanup_failed",
      message: "Anvil could not remove the directories.",
    });
  });
});

describe("cancelJob and deleteDraft", () => {
  it("wait longer than the 10 s default: they open an SSH session to Anvil", async () => {
    post.mockResolvedValue({ data: {} });
    del.mockResolvedValue({});
    await cancelJob("j");
    await deleteDraft("j");
    const timeouts = getApiClient.mock.calls.map((call) => (call[0] as { timeoutMs?: number } | undefined)?.timeoutMs);
    expect(timeouts).toHaveLength(2);
    for (const timeoutMs of timeouts) expect(timeoutMs).toBeGreaterThanOrEqual(60_000);
  });

  it("show the backend's message for any { code, message } detail, whatever the code", async () => {
    post.mockRejectedValue(refused(409, { code: "not_cancellable", message: "This simulation has already ended." }));
    await expect(cancelJob("j")).resolves.toMatchObject({
      status: 409,
      code: "not_cancellable",
      message: "This simulation has already ended.",
    });
    del.mockRejectedValue(refused(409, { code: "orphans_unresolved", message: "A job from an interrupted submit may still run." }));
    await expect(deleteDraft("j")).resolves.toMatchObject({ status: 409, code: "orphans_unresolved", message: "A job from an interrupted submit may still run." });
  });

  it("show a plain-string detail as the message too", async () => {
    post.mockRejectedValue(refused(409, "Job cannot be cancelled in status COMPLETED"));
    await expect(cancelJob("j")).resolves.toMatchObject({ status: 409, message: "Job cannot be cancelled in status COMPLETED" });
  });

  it("answer session_expired without calling the backend when there is no session (getApiClient refuses)", async () => {
    getApiClient.mockRejectedValue(Object.assign(new Error("Not signed in."), { response: { status: 401, data: {} } }));
    const expired = { ok: false, reason: "session_expired" };
    await expect(pollJobStatus("j")).resolves.toEqual(expired);
    await expect(cancelJob("j")).resolves.toEqual(expired);
    await expect(deleteDraft("j")).resolves.toEqual(expired);
    await expect(submitDraft("j")).resolves.toEqual(expired);
    for (const method of [get, post, patch, del]) expect(method).not.toHaveBeenCalled();
    getApiClient.mockImplementation(async () => ({ patch, post, get, delete: del }));
  });

  it("answer 401 (no token at all) as an ended session, for every action", async () => {
    post.mockRejectedValue(refused(401, "Not authenticated"));
    del.mockRejectedValue(refused(401, "Not authenticated"));
    get.mockRejectedValue(refused(401, "Not authenticated"));
    patch.mockRejectedValue(refused(401, "Not authenticated"));
    const expired = { ok: false, reason: "session_expired" };
    await expect(cancelJob("j")).resolves.toEqual(expired);
    await expect(deleteDraft("j")).resolves.toEqual(expired);
    await expect(pollJobStatus("j")).resolves.toEqual(expired);
    await expect(submitDraft("j")).resolves.toEqual(expired);
    await expect(duplicateDraft("j")).resolves.toEqual(expired);
    await expect(updateDraft("j", {})).resolves.toEqual(expired);
  });
});

describe("duplicateDraft", () => {
  it("POSTs to the job's duplicate route and returns the new draft", async () => {
    const draft = { id: "new-1", status: "DRAFT" };
    post.mockResolvedValue({ data: draft });
    await expect(duplicateDraft("job/1")).resolves.toEqual({ ok: true, data: draft });
    expect(post).toHaveBeenCalledWith("/api/v1/jobs/job%2F1/duplicate");
  });

  it("answers a gone snapshot with its code and message", async () => {
    post.mockRejectedValue(
      refused(422, { code: "snapshot_not_found", message: "The model snapshot is no longer in the repository." })
    );
    await expect(duplicateDraft("j")).resolves.toMatchObject({
      ok: false,
      reason: "error",
      code: "snapshot_not_found",
      message: "The model snapshot is no longer in the repository.",
    });
  });

  it("answers 404 as not found and 401 as an ended session", async () => {
    post.mockRejectedValueOnce(refused(404, "Job not found"));
    await expect(duplicateDraft("j")).resolves.toEqual({ ok: false, reason: "not_found" });
    post.mockRejectedValueOnce(refused(401));
    await expect(duplicateDraft("j")).resolves.toEqual({ ok: false, reason: "session_expired" });
  });
});

describe("submitDraft", () => {
  it("sends no body for an ordinary submit", async () => {
    post.mockResolvedValue({ data: { id: "job/1" } });
    await expect(submitDraft("job/1")).resolves.toEqual({ ok: true, data: { id: "job/1" } });
    expect(post).toHaveBeenCalledWith("/api/v1/jobs/job%2F1/submit");
  });

  it("sends no body for rerun: false either", async () => {
    post.mockResolvedValue({ data: {} });
    await submitDraft("j", { rerun: false });
    expect(post).toHaveBeenCalledWith("/api/v1/jobs/j/submit");
  });

  it("sends { rerun: true } when asked for a rerun", async () => {
    post.mockResolvedValue({ data: {} });
    await submitDraft("j", { rerun: true });
    expect(post).toHaveBeenCalledWith("/api/v1/jobs/j/submit", { rerun: true });
  });

  it("answers the refusal of a published draft with its code", async () => {
    post.mockRejectedValue(
      refused(409, { code: "answered_by_published", message: "The published results answer this draft." })
    );
    await expect(submitDraft("j")).resolves.toMatchObject({
      ok: false,
      reason: "error",
      status: 409,
      code: "answered_by_published",
    });
  });
});

describe("publishedAnswer", () => {
  const parameters = {
    temporal_range_start: "2000-01-01",
    temporal_range_end: "2001-12-31",
    spatial_domain: null,
    variables: ["discharge"],
    custom_params: null,
  };

  it("POSTs the parameters and the model input to the snapshot's published-answer route", async () => {
    const answer = { answered: true, reasons: [], period: null, run_id: "r", files: [] };
    post.mockResolvedValue({ data: answer });
    await expect(publishedAnswer("snap/1", parameters, "mi-1")).resolves.toEqual({ ok: true, data: answer });
    expect(post).toHaveBeenCalledWith(
      "/api/v1/repository/datasets/snap%2F1/published-answer",
      { parameters, model_input_id: "mi-1" }
    );
  });

  it("sends a null model input as null", async () => {
    post.mockResolvedValue({ data: {} });
    await publishedAnswer("s", parameters, null);
    expect(post.mock.calls[0][1]).toEqual({ parameters, model_input_id: null });
  });

  it("answers a closed listing with its code and status", async () => {
    post.mockRejectedValue(
      refused(502, { code: "published_listing_unavailable", message: "The published files could not be listed." })
    );
    await expect(publishedAnswer("s", parameters, null)).resolves.toMatchObject({
      ok: false,
      reason: "error",
      status: 502,
      code: "published_listing_unavailable",
    });
  });

  it("answers an unknown snapshot as not found and an ended session as such", async () => {
    post.mockRejectedValueOnce(refused(404, "Dataset not found"));
    await expect(publishedAnswer("s", parameters, null)).resolves.toEqual({ ok: false, reason: "not_found" });
    post.mockRejectedValueOnce(refused(401));
    await expect(publishedAnswer("s", parameters, null)).resolves.toEqual({ ok: false, reason: "session_expired" });
  });
});

describe("publishDraft", () => {
  const about = {
    name: "A run",
    description: "What it holds.",
    creator: [{ name: "Ada" }],
    license: "CC-BY-4.0",
    keywords: ["wbm"],
    tags: ["tutorial"],
  } as unknown as Parameters<typeof publishDraft>[1];

  it("posts the about, in a body of its own, to the job's publish route with the 60 s timeout", async () => {
    const publish = { state: "publishing", snapshot_id: "ab" };
    post.mockResolvedValue({ data: { publish } });
    await expect(publishDraft("job 1", about)).resolves.toEqual({ ok: true, data: { publish } });
    expect(post).toHaveBeenCalledWith("/api/v1/jobs/job%201/publish", { about });
    expect(getApiClient).toHaveBeenCalledWith({ timeoutMs: 60_000 });
  });

  it("answers 401 as session_expired and 404 as not_found", async () => {
    post.mockRejectedValue(refused(401));
    await expect(publishDraft("j", about)).resolves.toEqual({ ok: false, reason: "session_expired" });
    post.mockRejectedValue(refused(404));
    await expect(publishDraft("j", about)).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("carries a 409's code, message and reason", async () => {
    post.mockRejectedValue(
      refused(409, { code: "not_publishable", message: "A publish is already running.", reason: "publishing" })
    );
    await expect(publishDraft("j", about)).resolves.toEqual({
      ok: false,
      reason: "error",
      message: "A publish is already running.",
      status: 409,
      code: "not_publishable",
      conflictReason: "publishing",
    });
  });

  it("carries a 422 invalid_about's errors, from pydantic's shape or a plain one", async () => {
    post.mockRejectedValue(
      refused(422, {
        code: "invalid_about",
        message: "The about block is not valid.",
        errors: [
          { loc: ["body", "about", "tags", 0], msg: "Input should be one of the known tags", type: "enum" },
          { field: "about.license", message: "Not an SPDX identifier." },
          "The document is not valid.",
          { nothing: true },
        ],
      })
    );
    const result = await publishDraft("j", about);
    expect(result).toMatchObject({ ok: false, reason: "error", status: 422, code: "invalid_about" });
    expect((result as { errors?: unknown }).errors).toEqual([
      { path: "about.tags.0", message: "Input should be one of the known tags" },
      { path: "about.license", message: "Not an SPDX identifier." },
      { path: null, message: "The document is not valid." },
    ]);
  });

  it("carries a 422 invalid_custom_params' errors as one message per key path", async () => {
    patch.mockRejectedValue(
      refused(422, {
        code: "invalid_custom_params",
        message: "Some model parameters are not valid.",
        errors: { "wbmParam.alpha": "Enter a number.", "Glaciers": "", "wbmParam.Infiltration": "Choose FrAMES or HBV." },
      })
    );
    const result = await updateDraft("j", {});
    expect(result).toMatchObject({ ok: false, reason: "error", status: 422, code: "invalid_custom_params" });
    // An entry with no sentence is dropped, like an empty `errors` list item.
    expect((result as { fieldErrors?: unknown }).fieldErrors).toEqual({
      "wbmParam.alpha": "Enter a number.",
      "wbmParam.Infiltration": "Choose FrAMES or HBV.",
    });
    expect((result as { errors?: unknown }).errors).toBeUndefined();
  });

  it("carries a 503's code and message, as a submit does", async () => {
    post.mockRejectedValue(refused(503, { code: "anvil_unreachable", message: "Anvil could not be reached." }));
    await expect(publishDraft("j", about)).resolves.toMatchObject({
      ok: false,
      reason: "error",
      status: 503,
      code: "anvil_unreachable",
      message: "Anvil could not be reached.",
    });
  });
});
