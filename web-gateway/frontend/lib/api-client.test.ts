// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { auth, create } = vi.hoisted(() => ({ auth: vi.fn(), create: vi.fn(() => ({})) }));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("axios", () => ({ default: { create } }));

import { getApiClient } from "@/lib/api-client";
import { isUnauthorizedError } from "@/lib/auth-guard";
import { describeFailure } from "@/lib/action-failure";

beforeEach(() => {
  auth.mockReset();
  create.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

/** What the call throws, as a caller sees it. */
async function thrown(options?: Parameters<typeof getApiClient>[0]) {
  try {
    await getApiClient(options);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("getApiClient without a session", () => {
  it("builds no client and throws a 401 when nobody is signed in", async () => {
    auth.mockResolvedValue(null);
    const error = await thrown();
    expect(create).not.toHaveBeenCalled();
    expect(isUnauthorizedError(error)).toBe(true);
    expect(describeFailure(error, [404])).toEqual({ ok: false, reason: "session_expired" });
  });

  it("builds no client when the session's token could not be refreshed", async () => {
    auth.mockResolvedValue({ error: "RefreshTokenError", user: { accessToken: "dead", role: "user" } });
    const error = await thrown();
    expect(create).not.toHaveBeenCalled();
    expect(describeFailure(error, [404])).toEqual({ ok: false, reason: "session_expired" });
  });

  it("builds no client for a session that carries no token and no dev role", async () => {
    auth.mockResolvedValue({ user: {} });
    await thrown();
    expect(create).not.toHaveBeenCalled();
  });

  it("still builds one for a caller that is open to anonymous visitors", async () => {
    auth.mockResolvedValue(null);
    expect(await thrown({ allowAnonymous: true })).toBeUndefined();
    expect(create).toHaveBeenCalledOnce();
  });
});

describe("getApiClient with a session", () => {
  it("sends the bearer token", async () => {
    auth.mockResolvedValue({ user: { accessToken: "tok" } });
    await getApiClient({ timeoutMs: 60_000 });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 60_000,
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      })
    );
  });

  it("counts the development mock role as signed in", async () => {
    vi.stubEnv("NODE_ENV", "development");
    auth.mockResolvedValue({ user: { role: "admin" } });
    await getApiClient();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ headers: expect.objectContaining({ "X-Mock-Role": "admin" }) })
    );
  });
});
