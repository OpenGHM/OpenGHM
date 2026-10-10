import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApiClient, post, del } = vi.hoisted(() => ({ getApiClient: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ getApiClient }));

import { setGroupInterest } from "./actions";

beforeEach(() => {
  post.mockReset();
  del.mockReset();
  getApiClient.mockReset();
  getApiClient.mockResolvedValue({ post, delete: del });
});

describe("setGroupInterest", () => {
  it("POSTs to record the interest, with the visitor's own session", async () => {
    post.mockResolvedValue({ status: 204 });
    await expect(setGroupInterest(true)).resolves.toEqual({ ok: true, data: { interested: true } });
    expect(getApiClient).toHaveBeenCalledWith();
    expect(post).toHaveBeenCalledWith("/api/v1/community/group-interest");
    expect(del).not.toHaveBeenCalled();
  });

  it("DELETEs to withdraw it", async () => {
    del.mockResolvedValue({ status: 204 });
    await expect(setGroupInterest(false)).resolves.toEqual({ ok: true, data: { interested: false } });
    expect(del).toHaveBeenCalledWith("/api/v1/community/group-interest");
    expect(post).not.toHaveBeenCalled();
  });

  it("answers session_expired when there is no session", async () => {
    getApiClient.mockRejectedValue(Object.assign(new Error("Not signed in."), { response: { status: 401, data: {} } }));
    await expect(setGroupInterest(true)).resolves.toEqual({ ok: false, reason: "session_expired" });
  });

  it("answers with the backend's message when it refuses", async () => {
    post.mockRejectedValue({ response: { status: 403, data: { detail: "Your account is not active." } } });
    const result = await setGroupInterest(true);
    expect(result).toMatchObject({ ok: false, reason: "error", message: "Your account is not active.", status: 403 });
  });

  it("answers that the backend is unreachable when it does not answer", async () => {
    post.mockRejectedValue(Object.assign(new Error(""), { isAxiosError: true }));
    const result = await setGroupInterest(true);
    expect(result).toMatchObject({ ok: false, reason: "error", code: "backend_unreachable" });
  });
});
